import type { PrinterAdapter, PrintResult, TicketPayload } from "./PrinterAdapter";

/** Doble de pruebas: `isAvailable()` siempre false, así que con él `imprimirTicket.ts` siempre
 *  cae al respaldo en pantalla (ver ReciboEnPantallaScreen.tsx). La implementación real es
 *  usbPrinterAdapter.ts (ESC/POS por USB OTG). */
export const mockPrinterAdapter: PrinterAdapter = {
  async isAvailable() {
    return false;
  },
  async printTicket(_ticket: TicketPayload): Promise<PrintResult> {
    return { impreso: false, error: "Sin impresora térmica configurada (Fase 2f, pendiente de hardware real)" };
  },
};
