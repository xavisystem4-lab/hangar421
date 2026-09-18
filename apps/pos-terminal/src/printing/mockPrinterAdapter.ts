import type { PrinterAdapter, PrintResult, TicketPayload } from "./PrinterAdapter";

/** Única implementación existente hoy — Fase 2f (real, ESC/POS Bluetooth) queda pendiente de
 *  hardware. `isAvailable()` siempre false, así que `imprimirTicket.ts` siempre cae al respaldo
 *  en pantalla (ver ReciboEnPantallaScreen.tsx) — nunca se llega a `printTicket()` en la
 *  práctica, pero se implementa completo para que el contrato quede probado a nivel de interfaz
 *  (ver printing/imprimirTicket.spec.ts). */
export const mockPrinterAdapter: PrinterAdapter = {
  async isAvailable() {
    return false;
  },
  async printTicket(_ticket: TicketPayload): Promise<PrintResult> {
    return { impreso: false, error: "Sin impresora térmica configurada (Fase 2f, pendiente de hardware real)" };
  },
};
