import type { SQLiteDatabase } from "expo-sqlite";
import { uuid7 } from "@hangar421/shared";
import { obtenerOCrearSucursalIdLocal } from "./dispositivoLocal";

/** Turno de trabajo ("Mañana 07:00–15:00"), informativo. No confundir con el turno de CAJA
 *  (turnosRepo): ese es la apertura y el corte del efectivo. Ver migración 11. */
export interface TurnoTrabajo {
  id: string;
  nombre: string;
  horaInicio: string;
  horaFin: string;
}

/** "7:5" → null, "7:05" → "07:05", "24:00" → null. Se normaliza para que la lista ordene bien. */
export function normalizarHora(texto: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(texto.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

/** Valida los datos de un turno nuevo; devuelve el motivo del rechazo o null si está bien.
 *  Inicio y fin iguales no tienen sentido; fin antes que inicio sí (turno nocturno que cruza la
 *  medianoche, ej. 22:00–06:00). */
export function motivoTurnoInvalido(datos: { nombre: string; horaInicio: string; horaFin: string }): string | null {
  if (!datos.nombre.trim()) return "Ponle nombre al turno.";
  const inicio = normalizarHora(datos.horaInicio);
  const fin = normalizarHora(datos.horaFin);
  if (!inicio || !fin) return "Escribe las horas como HH:MM, por ejemplo 07:00.";
  if (inicio === fin) return "La hora de inicio y la de fin no pueden ser iguales.";
  return null;
}

export function textoTurno(t: TurnoTrabajo): string {
  return `${t.nombre} · ${t.horaInicio}–${t.horaFin}`;
}

export async function listarTurnosTrabajo(db: SQLiteDatabase): Promise<TurnoTrabajo[]> {
  const sucursalId = await obtenerOCrearSucursalIdLocal(db);
  const filas = await db.getAllAsync<any>(
    "SELECT id, nombre, hora_inicio, hora_fin FROM turnos_trabajo WHERE sucursal_id = ? AND activo = 1 ORDER BY hora_inicio, nombre",
    sucursalId,
  );
  return filas.map((f) => ({ id: f.id, nombre: f.nombre, horaInicio: f.hora_inicio, horaFin: f.hora_fin }));
}

export async function crearTurnoTrabajo(db: SQLiteDatabase, datos: { nombre: string; horaInicio: string; horaFin: string }): Promise<TurnoTrabajo> {
  const motivo = motivoTurnoInvalido(datos);
  if (motivo) throw new Error(motivo);
  const turno = { id: uuid7(), nombre: datos.nombre.trim(), horaInicio: normalizarHora(datos.horaInicio)!, horaFin: normalizarHora(datos.horaFin)! };
  const sucursalId = await obtenerOCrearSucursalIdLocal(db);
  await db.runAsync(
    "INSERT INTO turnos_trabajo (id, sucursal_id, nombre, hora_inicio, hora_fin, activo, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)",
    turno.id, sucursalId, turno.nombre, turno.horaInicio, turno.horaFin, new Date().toISOString(),
  );
  return turno;
}

/** Lo desactiva y deja "sin turno" a quien lo tenía, en una sola transacción. */
export async function eliminarTurnoTrabajo(db: SQLiteDatabase, turnoId: string): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync("UPDATE turnos_trabajo SET activo = 0 WHERE id = ?", turnoId);
    await db.runAsync("UPDATE usuarios_locales SET turno_trabajo_id = NULL WHERE turno_trabajo_id = ?", turnoId);
  });
}

export async function asignarTurnoTrabajo(db: SQLiteDatabase, usuarioLocalId: string, turnoId: string | null): Promise<void> {
  await db.runAsync("UPDATE usuarios_locales SET turno_trabajo_id = ? WHERE id = ?", turnoId, usuarioLocalId);
}
