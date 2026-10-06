/**
 * Lógica pura del aviso de pedidos de delivery (sin React ni I/O, probada en
 * avisosDelivery.spec.ts): qué pedidos son nuevos para esta terminal y cuánto esperar antes del
 * siguiente intento cuando el ERP no responde.
 */

/** Cada cuánto se revisa la bandeja con conexión normal. Rappi pide no consultar más seguido
 *  que cada 45 s; aquí se consulta al ERP propio, no a la plataforma. */
export const INTERVALO_NORMAL_MS = 30_000;
const ESPERA_MAXIMA_MS = 5 * 60_000;

/** Backoff exponencial controlado: 30 s, 60 s, 2 min, 4 min y luego 5 min fijos. */
export function esperaTrasFallos(fallosSeguidos: number): number {
  if (fallosSeguidos <= 0) return INTERVALO_NORMAL_MS;
  return Math.min(INTERVALO_NORMAL_MS * 2 ** (fallosSeguidos - 1), ESPERA_MAXIMA_MS);
}

/** Pedidos pendientes que esta terminal todavía no avisó. */
export function pedidosNuevos<T extends { id: string }>(pendientes: T[], yaAvisados: Iterable<string>): T[] {
  const vistos = new Set(yaAvisados);
  return pendientes.filter((p) => !vistos.has(p.id));
}

/** Lista de ids avisados que se guarda en la base local: solo los que siguen pendientes más los
 *  nuevos (así no crece sin límite) y con tope, por si la bandeja trae cientos. */
export function idsParaRecordar(pendientes: { id: string }[], tope = 200): string[] {
  return pendientes.map((p) => p.id).slice(0, tope);
}

export function textoAviso(nuevos: { nombreVisible: string; folioCorto?: string | null; ordenExternaId: string }[]): string {
  if (nuevos.length === 1) {
    const p = nuevos[0];
    return `Nuevo pedido de ${p.nombreVisible} #${p.folioCorto ?? p.ordenExternaId}`;
  }
  const plataformas = Array.from(new Set(nuevos.map((p) => p.nombreVisible))).join(", ");
  return `${nuevos.length} pedidos nuevos (${plataformas})`;
}

/** Minutos que lleva esperando un pedido — Uber cancela a ~11.5 min y Rappi a ~4 min. */
export function minutosEsperando(creadoEn: string, ahora = Date.now()): number {
  return Math.max(0, Math.floor((ahora - new Date(creadoEn).getTime()) / 60_000));
}
