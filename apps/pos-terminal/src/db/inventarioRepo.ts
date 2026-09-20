import type { SQLiteDatabase } from "expo-sqlite";
import { uuid7, SyncEntidad, SyncOperacion } from "@hangar421/shared";
import { encolarSync } from "./outboxRepo";
import { obtenerOCrearDispositivoId, obtenerOCrearSucursalIdLocal } from "./dispositivoLocal";
import type { ExistenciaInsumo } from "../inventario/niveles";

export type TipoMovimientoInv = "ENTRADA" | "SALIDA" | "AJUSTE" | "MERMA" | "CONTEO";

export interface MovimientoInventarioLocal {
  id: string;
  insumoId: string;
  nombreInsumo: string;
  tipo: TipoMovimientoInv;
  cantidad: number;
  motivo: string | null;
  createdAt: string;
}

/** Existencias de la sucursal activa, con los datos del insumo ya unidos — es lo que pinta la
 *  pantalla y lo que alimenta la lista de compras, así que se resuelve en una sola consulta. */
export async function listarExistencias(db: SQLiteDatabase): Promise<ExistenciaInsumo[]> {
  const sucursalId = await obtenerOCrearSucursalIdLocal(db);
  const filas = await db.getAllAsync<any>(
    `SELECT i.id, i.nombre, i.unidad_medida, i.costo_unitario, i.proveedor_nombre,
            COALESCE(inv.existencia, 0) AS existencia,
            COALESCE(inv.minimo, 0) AS minimo,
            inv.maximo
     FROM insumos i
     LEFT JOIN inventario_local inv ON inv.insumo_id = i.id AND inv.sucursal_id = ?
     WHERE i.activo = 1
     ORDER BY i.nombre`,
    sucursalId,
  );
  return filas.map((f) => ({
    insumoId: f.id,
    nombre: f.nombre,
    unidadMedida: f.unidad_medida,
    existencia: f.existencia,
    minimo: f.minimo,
    maximo: f.maximo,
    costoUnitario: f.costo_unitario,
    proveedorNombre: f.proveedor_nombre,
  }));
}

/**
 * Registra un movimiento: actualiza el saldo local y lo encola hacia el ERP, todo en una
 * transacción. El saldo autoritativo lo lleva el ERP —que aplica el mismo movimiento cuando le
 * llega— pero el local tiene que moverse ya o el cajero no vería el efecto de lo que acaba de
 * hacer hasta la próxima sincronización.
 *
 * CONTEO es distinto de los demás: no suma ni resta, FIJA la existencia al valor contado. Es la
 * misma semántica que `InventarioService.registrarMovimiento` en el backend, y tratarlo como un
 * ajuste relativo descuadraría el almacén en cada conteo físico.
 */
export async function registrarMovimiento(
  db: SQLiteDatabase,
  datos: { insumoId: string; tipo: TipoMovimientoInv; cantidad: number; motivo?: string; usuarioId: string },
): Promise<void> {
  const id = uuid7();
  const ahora = new Date().toISOString();
  const idempotencyKey = uuid7();
  const [sucursalId, dispositivoId] = await Promise.all([
    obtenerOCrearSucursalIdLocal(db),
    obtenerOCrearDispositivoId(db),
  ]);

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO movimientos_inventario (id, sucursal_id, insumo_id, tipo, cantidad, motivo, usuario_id, created_at, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, sucursalId, datos.insumoId, datos.tipo, datos.cantidad, datos.motivo ?? null, datos.usuarioId, ahora, idempotencyKey,
    );

    // La fila de inventario puede no existir todavía (insumo que nunca se movió en esta
    // sucursal), de ahí el upsert en vez de un UPDATE.
    if (datos.tipo === "CONTEO") {
      await db.runAsync(
        `INSERT INTO inventario_local (sucursal_id, insumo_id, existencia, minimo, updated_at) VALUES (?, ?, ?, 0, ?)
         ON CONFLICT(sucursal_id, insumo_id) DO UPDATE SET existencia = excluded.existencia, updated_at = excluded.updated_at`,
        sucursalId, datos.insumoId, datos.cantidad, ahora,
      );
    } else {
      const signo = datos.tipo === "ENTRADA" || datos.tipo === "AJUSTE" ? 1 : -1;
      await db.runAsync(
        `INSERT INTO inventario_local (sucursal_id, insumo_id, existencia, minimo, updated_at) VALUES (?, ?, ?, 0, ?)
         ON CONFLICT(sucursal_id, insumo_id) DO UPDATE SET existencia = existencia + ?, updated_at = ?`,
        sucursalId, datos.insumoId, signo * datos.cantidad, ahora, signo * datos.cantidad, ahora,
      );
    }

    await encolarSync(db, {
      entidad: SyncEntidad.MOVIMIENTO_INVENTARIO,
      operacion: SyncOperacion.CREATE,
      entidadId: id,
      sucursalId,
      dispositivoId,
      usuarioId: datos.usuarioId,
      payload: { insumoId: datos.insumoId, tipo: datos.tipo, cantidad: datos.cantidad, motivo: datos.motivo },
    });
  });
}

export async function listarMovimientosRecientes(db: SQLiteDatabase, limite = 30): Promise<MovimientoInventarioLocal[]> {
  const sucursalId = await obtenerOCrearSucursalIdLocal(db);
  const filas = await db.getAllAsync<any>(
    `SELECT m.id, m.insumo_id, COALESCE(i.nombre, '—') AS nombre, m.tipo, m.cantidad, m.motivo, m.created_at
     FROM movimientos_inventario m LEFT JOIN insumos i ON i.id = m.insumo_id
     WHERE m.sucursal_id = ? ORDER BY m.created_at DESC LIMIT ?`,
    sucursalId, limite,
  );
  return filas.map((f) => ({
    id: f.id,
    insumoId: f.insumo_id,
    nombreInsumo: f.nombre,
    tipo: f.tipo,
    cantidad: f.cantidad,
    motivo: f.motivo,
    createdAt: f.created_at,
  }));
}

interface InsumoRemoto {
  id: string; nombre: string; unidadMedida: string; costoUnitario: number;
  proveedorId?: string | null; proveedor?: { nombre: string } | null; activo: boolean;
}
interface ExistenciaRemota {
  insumoId: string; existencia: number | string; minimo: number | string; maximo?: number | string | null;
}

/**
 * Vuelca el inventario del ERP en la base local.
 *
 * El saldo del ERP GANA sobre el local: él ya aplicó las ventas de todas las terminales y los
 * movimientos de todas ellas, así que es la única foto completa. Lo que esta terminal tenga
 * pendiente en el outbox se volverá a aplicar server-side y bajará en el siguiente refresco —
 * por eso no se intenta reconciliar aquí, que es donde estos sistemas se llenan de bugs.
 */
export async function upsertInventario(db: SQLiteDatabase, insumos: InsumoRemoto[], existencias: ExistenciaRemota[]): Promise<void> {
  const sucursalId = await obtenerOCrearSucursalIdLocal(db);
  const ahora = new Date().toISOString();

  await db.withTransactionAsync(async () => {
    for (const i of insumos) {
      await db.runAsync(
        `INSERT INTO insumos (id, nombre, unidad_medida, costo_unitario, proveedor_id, proveedor_nombre, activo, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre, unidad_medida = excluded.unidad_medida,
           costo_unitario = excluded.costo_unitario, proveedor_id = excluded.proveedor_id,
           proveedor_nombre = excluded.proveedor_nombre, activo = excluded.activo, synced_at = excluded.synced_at`,
        i.id, i.nombre, i.unidadMedida ?? "pz", Number(i.costoUnitario) || 0,
        i.proveedorId ?? null, i.proveedor?.nombre ?? null, i.activo ? 1 : 0, ahora,
      );
    }

    for (const e of existencias) {
      await db.runAsync(
        `INSERT INTO inventario_local (sucursal_id, insumo_id, existencia, minimo, maximo, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(sucursal_id, insumo_id) DO UPDATE SET existencia = excluded.existencia,
           minimo = excluded.minimo, maximo = excluded.maximo, updated_at = excluded.updated_at`,
        sucursalId, e.insumoId, Number(e.existencia) || 0, Number(e.minimo) || 0,
        e.maximo != null ? Number(e.maximo) : null, ahora,
      );
    }
  });
}
