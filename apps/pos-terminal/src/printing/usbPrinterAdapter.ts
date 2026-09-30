import { impresoraUsb } from "../../modules/hangar-usb-printer";
import type { PrinterAdapter, PrintResult, TicketPayload } from "./PrinterAdapter";
import { prepararTicketParaImpresora } from "./formatoTicket";

/**
 * Impresora térmica ESC/POS por USB OTG (módulo nativo modules/hangar-usb-printer).
 *
 * `isAvailable()` solo dice si hay una impresora CONECTADA; el permiso USB se pide dentro de
 * `printTicket()` la primera vez (diálogo del sistema). Nunca lanza: cualquier falla vuelve como
 * `{ impreso: false }` y imprimirTicket.ts deja el ticket PENDIENTE con el recibo en pantalla.
 */
export const usbPrinterAdapter: PrinterAdapter = {
  async isAvailable() {
    return impresoraUsb.hayImpresora();
  },
  async printTicket(ticket: TicketPayload): Promise<PrintResult> {
    try {
      await impresoraUsb.imprimirTicket(prepararTicketParaImpresora(ticket), ticket.anchoMM ?? 80);
      return { impreso: true };
    } catch (e: any) {
      return { impreso: false, error: String(e?.message ?? e) };
    }
  },
};
