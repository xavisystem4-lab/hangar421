import type { SQLiteDatabase } from "expo-sqlite";
import { uuid7, SyncEntidad, SyncOperacion } from "@hangar421/shared";
import { encolarSync } from "./outboxRepo";
import { obtenerOCrearDispositivoId, obtenerOCrearSucursalIdLocal } from "./dispositivoLocal";
import { SECCIONES_INICIALES, idSeccionInicial, type SeccionInventario } from "../inventario/secciones";

/**
 * Secciones del conteo físico y la sección de cada insumo, de la sucursal activa (migración 15).
 *
 * Offline-first como el resto: cada cambio se guarda aquí y entra a la cola de sincronización en
 * la misma transacción; sin red se queda en la tablet hasta que vuelva. Lo que baja del ERP
 * (`aplicarSeccionesDelErp`) nunca pisa un cambio de esta tablet que todavía no subió.
 */

async function contexto(db: SQLiteDatabase) {
  const [sucursalId, dispositivoId] = await Promise.all([obtenerOCrearSucursalIdLocal(db), obtenerOCrearDispositivoId(db)]);
  return { sucursalId, dispositivoId };
}

async function encolarSeccion(db: SQLiteDatabase, s: SeccionInventario, ctx: { sucursalId: string; dispositivoId: string }, usuarioId?: string) {
  await encolarSync(db, {
    entidad: SyncEntidad.SECCION_INVENTARIO,
    operacion: SyncOperacion.UPDATE,
    entidadId: s.id,
    sucursalId: ctx.sucursalId,
    dispositivoId: ctx.dispositivoId,
    usuarioId,
    payload: { seccionId: s.id, nombre: s.nombre, orden: s.orden, activo: s.activo },
  });
}

/** Secciones de la sucursal activa (también las de baja: hacen falta para saber que una
 *  asignación ya no vale). La primera vez siembra las de inicio con ids deterministas. */
export async function listarSecciones(db: SQLiteDatabase): Promise<SeccionInventario[]> {
  const ctx = await contexto(db);
  let filas = await db.getAllAsync<any>(
    "SELECT id, nombre, orden, activo FROM secciones_inventario WHERE sucursal_id = ? ORDER BY orden, nombre",
    ctx.sucursalId,
  );
  if (filas.length === 0) {
    await db.withTransactionAsync(async () => {
      for (const s of SECCIONES_INICIALES) {
        const seccion = { id: idSeccionInicial(ctx.sucursalId, s.clave), nombre: s.nombre, orden: s.orden, activo: true };
        await db.runAsync(
          "INSERT OR IGNORE INTO secciones_inventario (id, sucursal_id, nombre, orden, activo) VALUES (?, ?, ?, ?, 1)",
          seccion.id, ctx.sucursalId, seccion.nombre, seccion.orden,
        );
        await encolarSeccion(db, seccion, ctx);
      }
    });
    filas = await db.getAllAsync<any>(
      "SELECT id, nombre, orden, activo FROM secciones_inventario WHERE sucursal_id = ? ORDER BY orden, nombre",
      ctx.sucursalId,
    );
  }
  return filas.map((f) => ({ id: f.id, nombre: f.nombre, orden: f.orden, activo: !!f.activo }));
}

/** insumoId → seccionId (null = elegido "sin sección") de los insumos asignados a mano. */
export async function listarAsignaciones(db: SQLiteDatabase): Promise<Map<string, string | null>> {
  const { sucursalId } = await contexto(db);
  const filas = await db.getAllAsync<{ insumo_id: string; seccion_id: string | null }>(
    "SELECT insumo_id, seccion_id FROM insumo_seccion WHERE sucursal_id = ?",
    sucursalId,
  );
  return new Map(filas.map((f) => [f.insumo_id, f.seccion_id]));
}

/** Alta (sin `id`) o renombre / baja (con `id`) de una sección. */
export async function guardarSeccion(
  db: SQLiteDatabase,
  datos: { id?: string; nombre: string; orden?: number; activo?: boolean },
  usuarioId?: string,
): Promise<SeccionInventario> {
  const nombre = datos.nombre.trim().slice(0, 60);
  if (!nombre) throw new Error("Ponle nombre a la sección.");
  const ctx = await contexto(db);
  const actual = datos.id
    ? await db.getFirstAsync<any>("SELECT id, nombre, orden, activo FROM secciones_inventario WHERE id = ?", datos.id)
    : null;
  const siguienteOrden = async () =>
    ((await db.getFirstAsync<{ m: number }>("SELECT COALESCE(MAX(orden), 0) AS m FROM secciones_inventario WHERE sucursal_id = ?", ctx.sucursalId))?.m ?? 0) + 1;
  const seccion: SeccionInventario = {
    id: actual?.id ?? uuid7(),
    nombre,
    orden: datos.orden ?? actual?.orden ?? (await siguienteOrden()),
    activo: datos.activo ?? (actual ? !!actual.activo : true),
  };
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO secciones_inventario (id, sucursal_id, nombre, orden, activo) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre, orden = excluded.orden, activo = excluded.activo`,
      seccion.id, ctx.sucursalId, seccion.nombre, seccion.orden, seccion.activo ? 1 : 0,
    );
    await encolarSeccion(db, seccion, ctx, usuarioId);
  });
  return seccion;
}

/** Pone un insumo en una sección de la sucursal activa (`seccionId` null = sin sección). */
export async function asignarSeccionInsumo(db: SQLiteDatabase, insumoId: string, seccionId: string | null, usuarioId?: string): Promise<void> {
  const ctx = await contexto(db);
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO insumo_seccion (insumo_id, sucursal_id, seccion_id) VALUES (?, ?, ?)
       ON CONFLICT(insumo_id, sucursal_id) DO UPDATE SET seccion_id = excluded.seccion_id`,
      insumoId, ctx.sucursalId, seccionId,
    );
    await encolarSync(db, {
      entidad: SyncEntidad.INSUMO_SECCION,
      operacion: SyncOperacion.UPDATE,
      entidadId: `${insumoId}:${ctx.sucursalId}`,
      sucursalId: ctx.sucursalId,
      dispositivoId: ctx.dispositivoId,
      usuarioId,
      payload: { insumoId, seccionId },
    });
  });
}

/**
 * Aplica lo que manda el ERP (GET /inventario/secciones). Lo que esta tablet cambió y todavía no
 * subió (en la cola, PENDING o ERROR) se respeta: bajar del ERP no puede deshacer un cambio local.
 * Una sección o asignación que existe aquí pero no en el ERP tampoco se borra: puede ser una que
 * se creó sin conexión y va en camino.
 */
export async function aplicarSeccionesDelErp(
  db: SQLiteDatabase,
  sucursalId: string,
  remoto: { secciones: SeccionInventario[]; asignaciones: { insumoId: string; seccionId: string | null }[] },
): Promise<void> {
  const pendientes = await db.getAllAsync<{ entidad: string; entidad_id: string }>(
    "SELECT entidad, entidad_id FROM sync_outbox WHERE entidad IN (?, ?) AND estado IN ('PENDING', 'ERROR', 'SYNCING')",
    SyncEntidad.SECCION_INVENTARIO, SyncEntidad.INSUMO_SECCION,
  );
  const seccionesPendientes = new Set(pendientes.filter((p) => p.entidad === SyncEntidad.SECCION_INVENTARIO).map((p) => p.entidad_id));
  const asignacionesPendientes = new Set(pendientes.filter((p) => p.entidad === SyncEntidad.INSUMO_SECCION).map((p) => p.entidad_id));

  await db.withTransactionAsync(async () => {
    for (const s of remoto.secciones) {
      if (seccionesPendientes.has(s.id)) continue;
      await db.runAsync(
        `INSERT INTO secciones_inventario (id, sucursal_id, nombre, orden, activo) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre, orden = excluded.orden, activo = excluded.activo`,
        s.id, sucursalId, s.nombre, s.orden, s.activo ? 1 : 0,
      );
    }
    for (const a of remoto.asignaciones) {
      if (asignacionesPendientes.has(`${a.insumoId}:${sucursalId}`)) continue;
      await db.runAsync(
        `INSERT INTO insumo_seccion (insumo_id, sucursal_id, seccion_id) VALUES (?, ?, ?)
         ON CONFLICT(insumo_id, sucursal_id) DO UPDATE SET seccion_id = excluded.seccion_id`,
        a.insumoId, sucursalId, a.seccionId,
      );
    }
  });
}
