import type { SQLiteDatabase } from "expo-sqlite";
import { guardarConfig, obtenerConfig } from "./configLocalRepo";

/**
 * Cuándo bajó la tablet por última vez lo que se edita en el ERP (catálogo, precios, inventario).
 *
 * Existe para que "hice un cambio en el ERP y la tablet no lo tiene" deje de ser un misterio: o
 * la última descarga buena fue hace mucho (sin red, ERP caído) o la descarga está fallando y aquí
 * queda el motivo. Vive en `config_local` porque es una foto, no un histórico.
 */
export interface ResultadoDescarga {
  ok: boolean;
  errores: string[];
  /** Cuándo terminó este intento (ISO). */
  fecha: string;
}

export interface EstadoDescarga {
  /** Última descarga SIN errores (ISO), o null si nunca la hubo. */
  ultimaCompleta: string | null;
  /** Último intento, haya salido bien o mal. */
  ultimoIntento: ResultadoDescarga | null;
}

const CLAVE_ULTIMA_COMPLETA = "descarga_erp_ultima_completa";
const CLAVE_ULTIMO_INTENTO = "descarga_erp_ultimo_intento";

export async function registrarResultadoDescarga(db: SQLiteDatabase, r: ResultadoDescarga): Promise<void> {
  await guardarConfig(db, CLAVE_ULTIMO_INTENTO, JSON.stringify(r));
  if (r.ok) await guardarConfig(db, CLAVE_ULTIMA_COMPLETA, r.fecha);
}

export async function leerEstadoDescarga(db: SQLiteDatabase): Promise<EstadoDescarga> {
  const [completa, intento] = await Promise.all([obtenerConfig(db, CLAVE_ULTIMA_COMPLETA), obtenerConfig(db, CLAVE_ULTIMO_INTENTO)]);
  let ultimoIntento: ResultadoDescarga | null = null;
  try {
    ultimoIntento = intento ? (JSON.parse(intento) as ResultadoDescarga) : null;
  } catch {
    ultimoIntento = null;
  }
  return { ultimaCompleta: completa, ultimoIntento };
}

/** "hace 3 min", "hace 2 h", "hace 4 días" — para el texto de Admin → Sincronización. */
export function haceCuanto(iso: string | null, ahora: Date = new Date()): string {
  if (!iso) return "nunca";
  const ms = ahora.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "nunca";
  const min = Math.max(0, Math.floor(ms / 60_000));
  if (min < 1) return "hace menos de un minuto";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} día${d === 1 ? "" : "s"}`;
}

/** Una descarga que lleva más de este tiempo sin completarse merece aviso en pantalla. */
export const DESCARGA_VIEJA_MS = 30 * 60_000;

export function descargaAtrasada(e: EstadoDescarga, ahora: Date = new Date()): boolean {
  if (!e.ultimaCompleta) return true;
  return ahora.getTime() - new Date(e.ultimaCompleta).getTime() > DESCARGA_VIEJA_MS;
}
