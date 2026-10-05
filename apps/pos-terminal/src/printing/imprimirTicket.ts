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
 *  Devuelve si salió impreso y, si no, el MOTIVO: el que da la impresora (permiso USB negado,
 *  se desconectó, falló la escritura…) o el de armar el ticket. Antes solo devolvía si salió, y
 *  la tablet decía "no se encontró la impresora" fuera cual fuera la falla — imposible de
 *  diagnosticar desde el mostrador. */
export async function imprimirTicket(
  db: SQLiteDatabase,
  ventaId: string,
  adapter: PrinterAdapter = usbPrinterAdapter,
): Promise<{ impreso: boolean; motivo?: string }> {
  try {
    const disponible = await adapter.isAvailable();
    if (!disponible) {
      await marcarTicketPendiente(db, ventaId);
      return { impreso: false, motivo: "No hay ninguna impresora USB conectada (o no se reconoce). Revisa el cable OTG y que esté encendida, en Admin → Impresora." };
    }
    const ticket = await construirTicketPayload(db, ventaId);
    const resultado = await adapter.printTicket(ticket);
    const decision = decidirResultadoTicket(disponible, resultado);
    await (decision === "IMPRESO" ? marcarTicketImpreso(db, ventaId) : marcarTicketPendiente(db, ventaId));
    return decision === "IMPRESO" ? { impreso: true } : { impreso: false, motivo: resultado?.error ?? "La impresora no confirmó la impresión." };
  } catch (e: any) {
    await marcarTicketPendiente(db, ventaId).catch(() => undefined);
    return { impreso: false, motivo: `No se pudo armar el ticket: ${e?.message ?? e}` };
  }
}
