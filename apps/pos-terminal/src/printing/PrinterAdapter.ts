export interface TicketItem {
  cantidad: number;
  nombre: string;
  precioTotal: number;
}

export interface TicketPayload {
  folio: number;
  fecha: string;
  items: TicketItem[];
  subtotal: number;
  total: number;
  pieTicket: string;
  razonSocial?: string;
  rfc?: string;
}

export interface PrintResult {
  impreso: boolean;
  error?: string;
}

/** Abstracción de impresora térmica — desacoplada por completo de la transacción de venta (ver
 *  db/ventasRepo.ts: la venta se confirma primero, SIEMPRE; esto se intenta después, como
 *  efecto secundario best-effort). Ninguna implementación real existe todavía (Fase 2f: agregar
 *  una librería ESC/POS Bluetooth — no verificable en este entorno sin tablet ni impresora
 *  física). `mockPrinterAdapter.ts` es la única implementación hoy: siempre reporta
 *  `isAvailable() === false`, así que el flujo de respaldo (imprimirTicket.ts →
 *  ReciboEnPantallaScreen) es lo único que corre en la práctica por ahora. */
export interface PrinterAdapter {
  isAvailable(): Promise<boolean>;
  printTicket(ticket: TicketPayload): Promise<PrintResult>;
}
