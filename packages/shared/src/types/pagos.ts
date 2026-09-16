import { EstadoSolicitudPago } from "../enums";

/** Forma que viaja por WebSocket (PAGO_SOLICITADO/PAGO_ACTUALIZADO) y por la respuesta de la API
 *  REST de pagos — la misma en POS, CRM y APK de Meseros. Nunca incluye datos de terminal
 *  sensibles ni credenciales del proveedor (eso nunca sale del backend). */
export interface PaymentRequestDTO {
  id: string;
  pedidoId: string;
  mesaId: string | null;
  mesaNombre: string | null;
  meseroId: string | null;
  terminalId: string;
  terminalNombre: string;
  proveedor: string;
  referenciaInterna: string;
  referenciaExterna: string | null;
  importe: number;
  moneda: string;
  estado: EstadoSolicitudPago;
  motivoError: string | null;
  expiraEn: string;
  createdAt: string;
  updatedAt: string;
}
