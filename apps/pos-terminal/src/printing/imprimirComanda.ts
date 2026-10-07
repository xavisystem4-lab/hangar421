import type { SQLiteDatabase } from "expo-sqlite";
import type { PrinterAdapter } from "./PrinterAdapter";
import { usbPrinterAdapter } from "./usbPrinterAdapter";
import { construirComandaPayload } from "../db/ticketsRepo";
import { obtenerConfig } from "../db/configLocalRepo";

/** Clave en config_local: "0" apaga la comanda automática al cobrar (Admin → Impresora). */
export const CLAVE_COMANDA_ACTIVA = "comanda_activa";

export async function comandaActiva(db: SQLiteDatabase): Promise<boolean> {
  return (await obtenerConfig(db, CLAVE_COMANDA_ACTIVA)) !== "0";
}

/**
 * Imprime la comanda de preparación de una venta ya confirmada. Igual que imprimirTicket, nunca
 * lanza ni toca la venta: si no hay impresora o falla, devuelve el motivo y listo — la comanda
 * se puede reimprimir después. Si el adaptador no sabe imprimir comandas (mock) no hace nada.
 */
export async function imprimirComanda(
  db: SQLiteDatabase,
  ventaId: string,
  adapter: PrinterAdapter = usbPrinterAdapter,
): Promise<{ impreso: boolean; motivo?: string }> {
  try {
    if (!adapter.printComanda) return { impreso: false, motivo: "Esta impresora no admite comandas." };
    if (!(await adapter.isAvailable())) {
      return { impreso: false, motivo: "No hay ninguna impresora USB conectada (o no se reconoce)." };
    }
    const resultado = await adapter.printComanda(await construirComandaPayload(db, ventaId));
    return resultado.impreso ? { impreso: true } : { impreso: false, motivo: resultado.error ?? "La impresora no confirmó la impresión." };
  } catch (e: any) {
    return { impreso: false, motivo: `No se pudo armar la comanda: ${e?.message ?? e}` };
  }
}
