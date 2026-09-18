import type { PrintResult } from "./PrinterAdapter";

export type ResultadoTicket = "IMPRESO" | "PENDIENTE";

/** Pura, sin I/O — decide si el ticket queda IMPRESO o PENDIENTE según lo que reportó el
 *  adaptador. Cualquier duda (adaptador no disponible, o disponible pero `printTicket()` no
 *  confirmó éxito) cae a PENDIENTE — nunca se asume impreso sin que el adaptador lo confirme
 *  explícitamente. */
export function decidirResultadoTicket(disponible: boolean, resultado: PrintResult | null): ResultadoTicket {
  if (!disponible || !resultado) return "PENDIENTE";
  return resultado.impreso ? "IMPRESO" : "PENDIENTE";
}
