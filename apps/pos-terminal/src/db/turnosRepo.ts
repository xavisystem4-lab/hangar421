import type { SQLiteDatabase } from "expo-sqlite";
import { uuid7, round2, SyncEntidad, SyncOperacion } from "@hangar421/shared";
import { encolarSync } from "./outboxRepo";
import { obtenerOCrearDispositivoId, obtenerOCrearSucursalIdLocal } from "./dispositivoLocal";

export interface TurnoLocal {
  id: string;
  usuarioId: string;
  montoInicial: number;
  montoFinalDeclarado: number | null;
  estado: "ABIERTO" | "CERRADO";
  abiertoAt: string;
  cerradoAt: string | null;
}

export interface MovimientoCajaLocal {
  id: string;
  turnoId: string;
  tipo: string;
  monto: number;
  motivo: string | null;
  createdAt: string;
}

export async function turnoAbierto(db: SQLiteDatabase): Promise<TurnoLocal | null> {
  const f = await db.getFirstAsync<any>("SELECT * FROM turnos WHERE estado = 'ABIERTO' ORDER BY abierto_at DESC LIMIT 1");
  if (!f) return null;
  return { id: f.id, usuarioId: f.usuario_id, montoInicial: f.monto_inicial, montoFinalDeclarado: f.monto_final_declarado, estado: f.estado, abiertoAt: f.abierto_at, cerradoAt: f.cerrado_at };
}

/** Abrir caja — una sola transacción: fila de turno + su evento de sync, todo o nada. */
export async function abrirTurno(db: SQLiteDatabase, datos: { usuarioId: string; montoInicial: number }): Promise<TurnoLocal> {
  const yaAbierto = await turnoAbierto(db);
  if (yaAbierto) throw new Error("Ya hay un turno de caja abierto");

  const id = uuid7();
  const ahora = new Date().toISOString();
  const idempotencyKey = uuid7();
  const [sucursalId, dispositivoId] = await Promise.all([obtenerOCrearSucursalIdLocal(db), obtenerOCrearDispositivoId(db)]);

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      "INSERT INTO turnos (id, usuario_id, monto_inicial, estado, abierto_at, idempotency_key) VALUES (?, ?, ?, 'ABIERTO', ?, ?)",
      id, datos.usuarioId, round2(datos.montoInicial), ahora, idempotencyKey,
    );
    await encolarSync(db, {
      entidad: SyncEntidad.TURNO,
      operacion: SyncOperacion.CREATE,
      entidadId: id,
      sucursalId,
      dispositivoId,
      usuarioId: datos.usuarioId,
      payload: { turnoId: id, cajaId: null, usuarioId: datos.usuarioId, montoInicial: round2(datos.montoInicial), idempotencyKey },
    });
  });

  return { id, usuarioId: datos.usuarioId, montoInicial: round2(datos.montoInicial), montoFinalDeclarado: null, estado: "ABIERTO", abiertoAt: ahora, cerradoAt: null };
}

/** Un solo movimiento (ingreso/egreso) dentro de un turno ya abierto — distinto de TURNO
 *  (abrir/cerrar el turno completo). `SyncEntidad.MOVIMIENTO_CAJA` + su caso en
 *  `sync.service.ts::enrutar()` ya existen (antes era un gap documentado, resuelto). Nota: el
 *  backend (`CajaService.registrarMovimiento`) exige `motivo` no vacío — un movimiento sin
 *  motivo se guarda local igual, pero al sincronizar queda en ERROR hasta que se le ponga uno
 *  (visible en el indicador de sync, no se pierde ni se bloquea nada). */
export async function registrarMovimientoCaja(
  db: SQLiteDatabase,
  datos: { turnoId: string; tipo: "INGRESO" | "EGRESO"; monto: number; motivo?: string; usuarioId: string },
): Promise<void> {
  const id = uuid7();
  const ahora = new Date().toISOString();
  const idempotencyKey = uuid7();
  const [sucursalId, dispositivoId] = await Promise.all([obtenerOCrearSucursalIdLocal(db), obtenerOCrearDispositivoId(db)]);

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      "INSERT INTO movimientos_caja (id, turno_id, tipo, monto, motivo, created_at, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?)",
      id, datos.turnoId, datos.tipo, round2(datos.monto), datos.motivo ?? null, ahora, idempotencyKey,
    );
    await encolarSync(db, {
      entidad: SyncEntidad.MOVIMIENTO_CAJA,
      operacion: SyncOperacion.CREATE,
      entidadId: id,
      sucursalId,
      dispositivoId,
      usuarioId: datos.usuarioId,
      payload: { turnoId: datos.turnoId, tipo: datos.tipo, monto: round2(datos.monto), motivo: datos.motivo },
    });
  });
}

export async function listarMovimientosCaja(db: SQLiteDatabase, turnoId: string): Promise<MovimientoCajaLocal[]> {
  const filas = await db.getAllAsync<any>("SELECT * FROM movimientos_caja WHERE turno_id = ? ORDER BY created_at", turnoId);
  return filas.map((f) => ({ id: f.id, turnoId: f.turno_id, tipo: f.tipo, monto: f.monto, motivo: f.motivo, createdAt: f.created_at }));
}

/** Cerrar caja — una sola transacción: actualiza el turno + su evento de sync. */
export async function cerrarTurno(db: SQLiteDatabase, datos: { turnoId: string; montoFinalDeclarado: number }): Promise<void> {
  const ahora = new Date().toISOString();
  const [sucursalId, dispositivoId, turno] = await Promise.all([
    obtenerOCrearSucursalIdLocal(db),
    obtenerOCrearDispositivoId(db),
    db.getFirstAsync<any>("SELECT * FROM turnos WHERE id = ?", datos.turnoId),
  ]);
  if (!turno) throw new Error("Turno no encontrado");

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      "UPDATE turnos SET estado = 'CERRADO', monto_final_declarado = ?, cerrado_at = ? WHERE id = ?",
      round2(datos.montoFinalDeclarado), ahora, datos.turnoId,
    );
    await encolarSync(db, {
      entidad: SyncEntidad.TURNO,
      operacion: SyncOperacion.UPDATE,
      entidadId: datos.turnoId,
      sucursalId,
      dispositivoId,
      usuarioId: turno.usuario_id,
      payload: { turnoId: datos.turnoId, montoFinalDeclarado: round2(datos.montoFinalDeclarado) },
    });
  });
}
