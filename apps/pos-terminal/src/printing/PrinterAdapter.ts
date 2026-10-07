export interface TicketItem {
  cantidad: number;
  nombre: string;
  precioTotal: number;
  /** Lo elegido en el modal de personalización ("Grande", "Avena", "Vainilla"), ya en texto.
   *  Va aparte del nombre para que la impresora pueda sangrarlo en una línea propia: en un
   *  ticket de 32 caracteres, "Latte Grande Avena Vainilla" no cabe en una sola. */
  modificadores?: string[];
}

export interface TicketPago {
  metodo: string;
  monto: number;
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
  /** Datos del encabezado y desglose para la impresora térmica (todos opcionales: lo que no
   *  venga no se imprime). */
  nombreSucursal?: string;
  direccion?: string;
  descuento?: number;
  /** "Cortesía" cuando el descuento es una cortesía; si falta, el ticket dice "Descuento". */
  etiquetaDescuento?: string;
  impuestos?: number;
  etiquetaImpuestos?: string;
  pagos?: TicketPago[];
  cambio?: number;
  /** Propina que pagó el cliente aparte del total (va anotada en el pago). */
  propina?: number;
  /** Texto del QR del pie (p. ej. URL de autofacturación). Sin él no se imprime QR. */
  qrTexto?: string;
  qrLeyenda?: string;
  /** Ancho del papel configurado en la terminal (Configuración inicial). */
  anchoMM?: 58 | 80;
  /** Nombre del pedido, para saber a quién se le entrega. Sin él no se imprime. */
  nombreCliente?: string;
}

/** Comanda de preparación: lo que cocina/barra necesita para armar el pedido — sin precios. */
export interface ComandaPayload {
  folio: number;
  fecha: string;
  items: { cantidad: number; nombre: string; modificadores?: string[]; notas?: string }[];
  nombreCliente?: string;
  /** Notas generales de la venta (p. ej. "DiDi #A123"). */
  notas?: string;
  nombreSucursal?: string;
  anchoMM?: 58 | 80;
}

export interface PrintResult {
  impreso: boolean;
  error?: string;
}

/** Abstracción de impresora térmica — desacoplada por completo de la transacción de venta (ver
 *  db/ventasRepo.ts: la venta se confirma primero, SIEMPRE; esto se intenta después, como
 *  efecto secundario best-effort). Implementaciones:
 *  - `usbPrinterAdapter.ts` — impresora ESC/POS por USB OTG (módulo nativo
 *    modules/hangar-usb-printer). Es la que usa imprimirTicket.ts por defecto.
 *  - `mockPrinterAdapter.ts` — nunca disponible; para pruebas.
 *  Si no hay impresora conectada o falla, el flujo de respaldo (imprimirTicket.ts →
 *  ReciboEnPantallaScreen) muestra el recibo en pantalla. */
export interface PrinterAdapter {
  isAvailable(): Promise<boolean>;
  printTicket(ticket: TicketPayload): Promise<PrintResult>;
  /** Opcional: un adaptador sin comanda (mock, APK viejo) simplemente no la imprime. */
  printComanda?(comanda: ComandaPayload): Promise<PrintResult>;
}
