/** Backoff exponencial para reintentos de sync_outbox — pura, sin I/O, fácil de probar.
 *  Base 30s, se duplica por cada intento fallido, tope en 15 minutos. El botón manual
 *  "Sincronizar ahora" (syncEngine.ts) siempre lo salta por completo. */
const BASE_MS = 30_000;
const TOPE_MS = 15 * 60_000;

export function calcularProximoReintentoMs(intentosPrevios: number): number {
  const delay = BASE_MS * Math.pow(2, Math.max(0, intentosPrevios));
  return Math.min(delay, TOPE_MS);
}

export function calcularProximoReintentoIso(intentosPrevios: number, ahora: Date = new Date()): string {
  return new Date(ahora.getTime() + calcularProximoReintentoMs(intentosPrevios)).toISOString();
}

export function yaPuedeReintentar(nextRetryAtIso: string | null, ahora: Date = new Date()): boolean {
  if (!nextRetryAtIso) return true;
  return ahora.getTime() >= new Date(nextRetryAtIso).getTime();
}
