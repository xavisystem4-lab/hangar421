import type { SQLiteDatabase } from "expo-sqlite";
import { SyncEntidad } from "@hangar421/shared";
import { obtenerSucursalErp } from "./dispositivoLocal";
import { listarSucursalesTerminal } from "./multisucursalRepo";

/** Mensaje con que el ERP rechaza un evento de una sucursal a la que la terminal no tiene acceso
 *  (`AlcanceSync.motivoDeRechazo` en el backend). */
const SIN_ACCESO = "No tienes acceso a esta sucursal";

export interface AltaRechazada {
  localId: string;
  usuarioId: string;
  sucursalId: string;
  ultimoError: string | null;
}

/**
 * Altas de usuario (USUARIO/CREATE) que hay que mover a la sucursal activa. Pura, para probarla.
 *
 * Solo las rechazadas por "no tienes acceso" Y cuya sucursal ya NO es de esta terminal: la persona
 * se dio de alta en una sucursal con la que la tablet estuvo enlazada antes (o una que le quitaron
 * al código de la terminal). Ese rechazo es permanente — reintentarla igual fallaría siempre — y la
 * persona sigue trabajando en esta tablet. Nunca se mueve a alguien que está en una sucursal válida
 * de la terminal: ahí el rechazo tendría otra causa y moverla la cambiaría de sucursal sin motivo.
 */
export function altasARepuntar(filas: AltaRechazada[], sucursalesValidas: string[]): AltaRechazada[] {
  const validas = new Set(sucursalesValidas);
  return filas.filter((f) => (f.ultimoError ?? "").includes(SIN_ACCESO) && !validas.has(f.sucursalId));
}

/**
 * Repara en la tablet las altas de usuario rechazadas por pertenecer a una sucursal que la
 * terminal ya no tiene: las pasa a la sucursal activa (el alta en la cola y el usuario local) y
 * las devuelve a la cola. Devuelve cuántas corrigió.
 */
export async function repuntarAltasDeUsuarioSinAcceso(db: SQLiteDatabase): Promise<number> {
  const activa = await obtenerSucursalErp(db);
  if (!activa) return 0;
  const deTerminal = (await listarSucursalesTerminal(db)).map((s) => s.id);
  const validas = deTerminal.length > 0 ? deTerminal : [activa];
  if (!validas.includes(activa)) return 0;

  const filas = await db.getAllAsync<{ local_id: string; entidad_id: string; sucursal_id: string; ultimo_error: string | null }>(
    "SELECT local_id, entidad_id, sucursal_id, ultimo_error FROM sync_outbox WHERE estado = 'ERROR' AND entidad = ?",
    SyncEntidad.USUARIO,
  );
  const aMover = altasARepuntar(
    filas.map((f) => ({ localId: f.local_id, usuarioId: f.entidad_id, sucursalId: f.sucursal_id, ultimoError: f.ultimo_error })),
    validas,
  );
  if (aMover.length === 0) return 0;

  await db.withTransactionAsync(async () => {
    for (const a of aMover) {
      await db.runAsync(
        "UPDATE sync_outbox SET sucursal_id = ?, estado = 'PENDING', ultimo_error = NULL, next_retry_at = NULL WHERE local_id = ?",
        activa, a.localId,
      );
      await db.runAsync("UPDATE usuarios_locales SET sucursal_id = ? WHERE id = ? AND sucursal_id = ?", activa, a.usuarioId, a.sucursalId);
    }
  });
  return aMover.length;
}
