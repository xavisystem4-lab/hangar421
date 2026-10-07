import type { SQLiteDatabase } from "expo-sqlite";
import { uuid7, SyncEntidad, SyncOperacion, type Promocion } from "@hangar421/shared";
import type { DatosPromocion } from "../caja/promocion";
import { encolarSync } from "./outboxRepo";
import { obtenerOCrearDispositivoId, obtenerOCrearSucursalIdLocal } from "./dispositivoLocal";

/** Promociones de catálogo en la tablet (ver packages/shared/src/promociones.ts).
 *
 *  Se crean y editan aquí y viajan al ERP como `SyncEntidad.PROMOCION` con la definición COMPLETA
 *  (CREATE y UPDATE son un upsert); apagarla es un UPDATE con `activo: false`. El pull del
 *  catálogo las baja para las demás tablets. Vender con una promoción no cambia el inventario: el
 *  producto es el mismo, solo cambia su precio. */

interface FilaPromocion {
  id: string; nombre: string; tipo: "PRECIO" | "PORCENTAJE"; valor: number; dias: string;
  hora_inicio: string | null; hora_fin: string | null; fecha_inicio: string | null; fecha_fin: string | null;
  sucursal_id: string | null; activo: number;
}

const diasDeTexto = (t: string | null | undefined): number[] =>
  (t ?? "").split(",").map((x) => x.trim()).filter((x) => x !== "").map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);

/** Todas las promociones (también las apagadas, para poder reactivarlas), con sus productos. */
export async function listarPromociones(db: SQLiteDatabase): Promise<Promocion[]> {
  const filas = await db.getAllAsync<FilaPromocion>(
    "SELECT id, nombre, tipo, valor, dias, hora_inicio, hora_fin, fecha_inicio, fecha_fin, sucursal_id, activo FROM promociones ORDER BY nombre",
  );
  if (filas.length === 0) return [];
  const links = await db.getAllAsync<{ promocion_id: string; producto_id: string }>("SELECT promocion_id, producto_id FROM promocion_productos");
  const productos = new Map<string, string[]>();
  for (const l of links) productos.set(l.promocion_id, [...(productos.get(l.promocion_id) ?? []), l.producto_id]);
  return filas.map((f) => ({
    id: f.id, nombre: f.nombre, tipo: f.tipo, valor: Number(f.valor), productoIds: productos.get(f.id) ?? [],
    dias: diasDeTexto(f.dias), horaInicio: f.hora_inicio, horaFin: f.hora_fin, fechaInicio: f.fecha_inicio, fechaFin: f.fecha_fin,
    sucursalId: f.sucursal_id, activo: f.activo === 1,
  }));
}

async function escribirLocal(db: SQLiteDatabase, id: string, datos: DatosPromocion, activo: boolean, sincronizada: string | null): Promise<void> {
  await db.runAsync(
    `INSERT INTO promociones (id, nombre, tipo, valor, dias, hora_inicio, hora_fin, fecha_inicio, fecha_fin, sucursal_id, activo, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre, tipo = excluded.tipo, valor = excluded.valor, dias = excluded.dias,
       hora_inicio = excluded.hora_inicio, hora_fin = excluded.hora_fin, fecha_inicio = excluded.fecha_inicio, fecha_fin = excluded.fecha_fin,
       sucursal_id = excluded.sucursal_id, activo = excluded.activo, synced_at = excluded.synced_at`,
    id, datos.nombre, datos.tipo, datos.valor, datos.dias.join(","), datos.horaInicio ?? null, datos.horaFin ?? null,
    datos.fechaInicio ?? null, datos.fechaFin ?? null, datos.sucursalId ?? null, activo ? 1 : 0, sincronizada,
  );
  await db.runAsync("DELETE FROM promocion_productos WHERE promocion_id = ?", id);
  for (const productoId of datos.productoIds) {
    await db.runAsync("INSERT OR IGNORE INTO promocion_productos (promocion_id, producto_id) VALUES (?, ?)", id, productoId);
  }
}

async function guardarYEncolar(
  db: SQLiteDatabase, id: string, datos: DatosPromocion, activo: boolean, operacion: SyncOperacion, usuarioId?: string,
): Promise<void> {
  const [sucursalId, dispositivoId] = await Promise.all([obtenerOCrearSucursalIdLocal(db), obtenerOCrearDispositivoId(db)]);
  await db.withTransactionAsync(async () => {
    await escribirLocal(db, id, datos, activo, null);
    await encolarSync(db, {
      entidad: SyncEntidad.PROMOCION,
      operacion,
      entidadId: id,
      sucursalId,
      dispositivoId,
      usuarioId,
      payload: {
        nombre: datos.nombre, tipo: datos.tipo, valor: datos.valor, productoIds: datos.productoIds, dias: datos.dias,
        horaInicio: datos.horaInicio ?? null, horaFin: datos.horaFin ?? null, fechaInicio: datos.fechaInicio ?? null, fechaFin: datos.fechaFin ?? null,
        sucursalId: datos.sucursalId ?? null, activo,
      },
    });
  });
}

/** Crea una promoción (activa) y la manda al ERP. Devuelve su id. */
export async function crearPromocion(db: SQLiteDatabase, datos: DatosPromocion, usuarioId?: string): Promise<string> {
  const id = uuid7();
  await guardarYEncolar(db, id, datos, true, SyncOperacion.CREATE, usuarioId);
  return id;
}

/** Edita una promoción existente (nombre, precio/%, productos, días, horario, fechas, sucursal). */
export async function editarPromocion(db: SQLiteDatabase, id: string, datos: DatosPromocion, activo: boolean, usuarioId?: string): Promise<void> {
  await guardarYEncolar(db, id, datos, activo, SyncOperacion.UPDATE, usuarioId);
}

/** Enciende o apaga una promoción sin perder su configuración. */
export async function alternarPromocion(db: SQLiteDatabase, promocion: Promocion, activo: boolean, usuarioId?: string): Promise<void> {
  const { id, activo: _viejo, ...datos } = promocion;
  await guardarYEncolar(db, id, datos, activo, SyncOperacion.UPDATE, usuarioId);
}

export interface PromocionRemota {
  id: string; nombre: string; tipo: "PRECIO" | "PORCENTAJE"; valor: number | string; productoIds?: string[]; dias?: number[];
  horaInicio?: string | null; horaFin?: string | null; fechaInicio?: string | null; fechaFin?: string | null;
  sucursalId?: string | null; activo: boolean;
}

/** Guarda las promociones que baja el ERP (GET /catalogo/promociones). Una promoción con cambios
 *  aún sin subir NO se pisa con la versión vieja del ERP, y las que ya no vienen se quitan salvo
 *  que estén pendientes de subir. */
export async function guardarPromocionesRemotas(db: SQLiteDatabase, remotas: PromocionRemota[]): Promise<void> {
  const ahora = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    const pendientes = new Set(
      (await db.getAllAsync<{ entidad_id: string }>(
        "SELECT DISTINCT entidad_id FROM sync_outbox WHERE entidad = 'PROMOCION' AND estado IN ('PENDING','SYNCING','ERROR')",
      )).map((f) => f.entidad_id),
    );
    for (const r of remotas) {
      if (pendientes.has(r.id)) continue;
      await escribirLocal(
        db, r.id,
        {
          nombre: r.nombre, tipo: r.tipo, valor: Number(r.valor), productoIds: r.productoIds ?? [], dias: r.dias ?? [],
          horaInicio: r.horaInicio ?? null, horaFin: r.horaFin ?? null, fechaInicio: r.fechaInicio ?? null, fechaFin: r.fechaFin ?? null,
          sucursalId: r.sucursalId ?? null,
        },
        r.activo, ahora,
      );
    }
    const vigentes = new Set(remotas.map((r) => r.id));
    const locales = await db.getAllAsync<{ id: string }>("SELECT id FROM promociones");
    for (const { id } of locales) {
      if (vigentes.has(id) || pendientes.has(id)) continue;
      await db.runAsync("DELETE FROM promocion_productos WHERE promocion_id = ?", id);
      await db.runAsync("DELETE FROM promociones WHERE id = ?", id);
    }
  });
}
