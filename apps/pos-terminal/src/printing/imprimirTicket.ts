import type { SQLiteDatabase } from "expo-sqlite";
import type { PrinterAdapter } from "./PrinterAdapter";
import { decidirResultadoTicket } from "./decisionImpresion";
import { usbPrinterAdapter } from "./usbPrinterAdapter";
import { construirTicketPayload, marcarTicketImpreso, marcarTicketPendiente } from "../db/ticketsRepo";

/** Se llama DESPUÉS de que ventasRepo.confirmarVenta() ya resolvió — la venta está confirmada
 *  pase lo que pase aquí abajo. Nunca lanza: cualquier error del adaptador (o de construir el
 *  payload) se atrapa y el ticket queda PENDIENTE, reintentable después desde el historial —
 *  "no debe bloquear ventas" aplica también a que un error de impresión bloquee la SIGUIENTE
 *  venta.
 *
 *  Devuelve si salió impreso, para que una reimpresión pueda decir "no hay impresora" en vez de
 *  quedarse callada. */
export async function imprimirTicket(db: SQLiteDatabase, ventaId: string, adapter: PrinterAdapter = usbPrinterAdapter): Promise<boolean> {
  try {
    const disponible = await adapter.isAvailable();
    if (!disponible) {
      await marcarTicketPendiente(db, ventaId);
      return false;
    }
    const ticket = await construirTicketPayload(db, ventaId);
    const resultado = await adapter.printTicket(ticket);
    const decision = decidirResultadoTicket(disponible, resultado);
    await (decision === "IMPRESO" ? marcarTicketImpreso(db, ventaId) : marcarTicketPendiente(db, ventaId));
    return decision === "IMPRESO";
  } catch {
    await marcarTicketPendiente(db, ventaId).catch(() => undefined);
    return false;
  }
}
