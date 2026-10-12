import type { SQLiteDatabase } from "expo-sqlite";
import { SyncEntidad, SyncOperacion, factorConversionUnidad, uuid7 } from "@hangar421/shared";
import { encolarSync } from "./outboxRepo";
import { obtenerOCrearDispositivoId, obtenerOCrearSucursalIdLocal } from "./dispositivoLocal";
import type { InsumoValidado } from "../inventario/altaInsumo";

/**
 * Alta y edición de insumos desde la tablet, PRIMERO en la base local.
 *
 * Antes esto iba directo al ERP: sin señal —o con una cuenta de tablet sin rol de administrador
 * en el ERP ("Forbidden resource")— no se podía dar de alta ni corregir un insumo. Ahora se
 * guarda aquí, se ve al instante en Existencias/Conteo/Insumos y viaja al ERP por la cola
 * (`SyncEntidad.INSUMO`) cuando haya conexión, con el mismo id. Quién puede hacerlo lo decide el
 * permiso de la persona en la tablet, como el resto del Admin.
 *
 * `synced_at` queda en NULL hasta que el ERP lo devuelva en una descarga: así la descarga no lo
 * apaga por "no venir" (ver upsertInventario).
 */

async function contexto(db: SQLiteDatabase) {
  const [sucursalId, dispositivoId] = await Promise.all([obtenerOCrearSucursalIdLocal(db), obtenerOCrearDispositivoId(db)]);
  return { sucursalId, dispositivoId };
}

export async function crearInsumoLocal(
  db: SQLiteDatabase,
  datos: InsumoValidado,
  proveedorNombre: string | null,
  usuarioId: string | null,
): Promise<string> {
  const id = uuid7();
  const ahora = new Date().toISOString();
  const { sucursalId, dispositivoId } = await contexto(db);
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO insumos (id, nombre, unidad_medida, costo_unitario, proveedor_id, proveedor_nombre, activo, synced_at, presentacion_nombre, presentacion_cantidad, es_preparacion)
       VALUES (?, ?, ?, ?, ?, ?, 1, NULL, ?, ?, 0)`,
      id, datos.nombre, datos.unidadMedida, datos.costoUnitario, datos.proveedorId, proveedorNombre,
      datos.presentacionNombre, datos.presentacionCantidad,
    );
    await db.runAsync(
      `INSERT INTO inventario_local (sucursal_id, insumo_id, existencia, minimo, maximo, updated_at) VALUES (?, ?, 0, ?, ?, ?)
       ON CONFLICT(sucursal_id, insumo_id) DO UPDATE SET minimo = excluded.minimo, maximo = excluded.maximo, updated_at = excluded.updated_at`,
      sucursalId, id, datos.minimo ?? 0, datos.maximo ?? null, ahora,
    );
    await encolarSync(db, {
      entidad: SyncEntidad.INSUMO,
      operacion: SyncOperacion.CREATE,
      entidadId: id,
      sucursalId,
      dispositivoId,
      usuarioId: usuarioId ?? undefined,
      payload: {
        nombre: datos.nombre, unidadMedida: datos.unidadMedida, costoUnitario: datos.costoUnitario,
        proveedorId: datos.proveedorId, minimo: datos.minimo, maximo: datos.maximo,
        presentacionNombre: datos.presentacionNombre, presentacionCantidad: datos.presentacionCantidad,
      },
    });
  });
  return id;
}

/**
 * Edita un insumo. Si cambia la unidad y `convertir` es true, reescala aquí mismo lo que estaba en
 * la unidad vieja (existencias y mínimos, costo, empaque y recetas), igual que lo hará el ERP al
 * recibir el cambio.
 */
export async function actualizarInsumoLocal(
  db: SQLiteDatabase,
  id: string,
  datos: InsumoValidado,
  opciones: { unidadAnterior: string; convertir: boolean; proveedorNombre: string | null; usuarioId: string | null },
): Promise<void> {
  const ahora = new Date().toISOString();
  const { sucursalId, dispositivoId } = await contexto(db);
  const cambiaUnidad = opciones.unidadAnterior !== datos.unidadMedida;
  const factor = cambiaUnidad && opciones.convertir ? factorConversionUnidad(opciones.unidadAnterior, datos.unidadMedida) : null;
  const aplicar = factor !== null && factor !== 1;

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE insumos SET nombre = ?, unidad_medida = ?, costo_unitario = ?, proveedor_id = ?, proveedor_nombre = ?,
         presentacion_nombre = ?, presentacion_cantidad = ? WHERE id = ?`,
      datos.nombre, datos.unidadMedida, datos.costoUnitario, datos.proveedorId, opciones.proveedorNombre,
      datos.presentacionNombre, datos.presentacionCantidad, id,
    );
    if (aplicar) {
      await db.runAsync(
        "UPDATE inventario_local SET existencia = existencia * ?, minimo = minimo * ?, maximo = CASE WHEN maximo IS NULL THEN NULL ELSE maximo * ? END WHERE insumo_id = ?",
        factor, factor, factor, id,
      );
      await db.runAsync("UPDATE recetas SET cantidad = cantidad * ? WHERE insumo_id = ?", factor, id);
      await db.runAsync("UPDATE recetas_opcion SET cantidad = cantidad * ? WHERE insumo_id = ?", factor, id);
      await db.runAsync("UPDATE recetas_preparacion SET cantidad = cantidad * ? WHERE insumo_id = ?", factor, id);
      await db.runAsync("UPDATE recetas_preparacion SET cantidad = cantidad / ? WHERE preparacion_id = ?", factor, id);
    }
    // Mínimo y máximo de ESTA sucursal (lo capturado ya está en la unidad nueva).
    if (datos.minimo !== undefined || datos.maximo !== undefined) {
      await db.runAsync(
        `INSERT INTO inventario_local (sucursal_id, insumo_id, existencia, minimo, maximo, updated_at) VALUES (?, ?, 0, ?, ?, ?)
         ON CONFLICT(sucursal_id, insumo_id) DO UPDATE SET minimo = excluded.minimo, maximo = excluded.maximo, updated_at = excluded.updated_at`,
        sucursalId, id, datos.minimo ?? 0, datos.maximo ?? null, ahora,
      );
    }
    await encolarSync(db, {
      entidad: SyncEntidad.INSUMO,
      operacion: SyncOperacion.UPDATE,
      entidadId: id,
      sucursalId,
      dispositivoId,
      usuarioId: opciones.usuarioId ?? undefined,
      payload: {
        nombre: datos.nombre, costoUnitario: datos.costoUnitario, proveedorId: datos.proveedorId,
        presentacionNombre: datos.presentacionNombre, presentacionCantidad: datos.presentacionCantidad,
        ...(datos.minimo !== undefined || datos.maximo !== undefined ? { minimo: datos.minimo ?? 0, maximo: datos.maximo ?? null } : {}),
        ...(cambiaUnidad ? { cambioUnidad: { unidadMedida: datos.unidadMedida, convertir: opciones.convertir } } : {}),
      },
    });
  });
}

/** Baja lógica o reactivación. */
export async function cambiarActivoInsumoLocal(db: SQLiteDatabase, id: string, activo: boolean, usuarioId: string | null): Promise<void> {
  const { sucursalId, dispositivoId } = await contexto(db);
  await db.withTransactionAsync(async () => {
    await db.runAsync("UPDATE insumos SET activo = ? WHERE id = ?", activo ? 1 : 0, id);
    await encolarSync(db, {
      entidad: SyncEntidad.INSUMO, operacion: SyncOperacion.UPDATE, entidadId: id, sucursalId, dispositivoId, usuarioId: usuarioId ?? undefined, payload: { activo },
    });
  });
}

/** Insumos con cambios hechos aquí que el ERP todavía no confirma: la descarga no debe pisarlos. */
export async function insumosConCambiosPendientes(db: SQLiteDatabase): Promise<Set<string>> {
  const filas = await db.getAllAsync<{ entidad_id: string }>(
    "SELECT DISTINCT entidad_id FROM sync_outbox WHERE entidad = ? AND estado IN ('PENDING','SYNCING','ERROR')",
    SyncEntidad.INSUMO,
  );
  return new Set(filas.map((f) => f.entidad_id));
}

/** Proveedores conocidos en la tablet (los de los insumos ya descargados), para elegir sin red. */
export async function proveedoresLocales(db: SQLiteDatabase): Promise<{ id: string; nombre: string }[]> {
  const filas = await db.getAllAsync<{ id: string; nombre: string }>(
    "SELECT DISTINCT proveedor_id AS id, proveedor_nombre AS nombre FROM insumos WHERE proveedor_id IS NOT NULL AND proveedor_nombre IS NOT NULL ORDER BY proveedor_nombre",
  );
  return filas;
}
