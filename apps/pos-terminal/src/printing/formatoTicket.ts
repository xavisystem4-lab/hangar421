import type { TicketPayload } from "./PrinterAdapter";

/**
 * Funciones puras para preparar el ticket antes de mandarlo a la impresora nativa. Sin I/O ni
 * dependencias de React Native, para poder probarlas con Jest (formatoTicket.spec.ts).
 */

const dos = (n: number) => String(n).padStart(2, "0");

/** "30/09/2026 14:05" en la hora local de la tablet — el mismo instante que ve el cajero. */
export function formatearFechaTicket(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${dos(d.getDate())}/${dos(d.getMonth() + 1)}/${d.getFullYear()} ${dos(d.getHours())}:${dos(d.getMinutes())}`;
}

/**
 * Parte de IVA contenida en un precio final. Solo informativa para el desglose del ticket: los
 * precios del catálogo ya incluyen impuestos y el cobro no cambia (ver calculos.ts en
 * packages/shared, donde `impuesto` es siempre 0).
 */
export function ivaIncluido(total: number, tasa: number): number {
  if (!(tasa > 0) || !(total > 0)) return 0;
  return Math.round((total - total / (1 + tasa)) * 100) / 100;
}

const ETIQUETA_METODO: Record<string, string> = {
  EFECTIVO: "Efectivo",
  EFECTIVO_USD: "Dólares",
  TARJETA: "Tarjeta",
  TRANSFERENCIA: "Transferencia",
  QR: "Pago QR",
  OTRO: "Otro",
};

export function etiquetaMetodoPago(metodo: string): string {
  return ETIQUETA_METODO[metodo] ?? metodo;
}

/** Lo que recibe el renderer nativo (TicketRenderer.kt): el payload más los textos ya formateados. */
export function prepararTicketParaImpresora(t: TicketPayload): TicketPayload & { fechaTexto: string } {
  return {
    ...t,
    fechaTexto: formatearFechaTicket(t.fecha),
    pagos: t.pagos?.map((p) => ({ ...p, metodo: etiquetaMetodoPago(p.metodo) })),
  };
}

/** Propina anotada en la referencia de un pago ("Propina $20.00", ver PosCobroScreen). 0 si no hay. */
export function propinaDeReferencia(referencia: string | null | undefined): number {
  const m = /Propina \$([\d,]+(?:\.\d+)?)/.exec(referencia ?? "");
  return m ? Number(m[1].replace(/,/g, "")) || 0 : 0;
}
