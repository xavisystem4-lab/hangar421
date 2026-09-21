import { SyncEntidad, SyncOperacion, SyncStatus } from "../enums";

/** Contrato de sincronización usado por todos los clientes (POS, mesero, cocina).
 *  Ver docs/sync-flows.md para el flujo completo. */

export interface SyncEnvelope<T = unknown> {
  /** UUID v7 generado en el cliente — es también el id final de la entidad. */
  id: string;
  entidad: SyncEntidad;
  operacion: SyncOperacion;
  /** hash(deviceId + entidad + operacion + secuenciaLocal) — evita duplicados en reintentos. */
  idempotencyKey: string;
  dispositivoId: string;
  sucursalId: string;
  usuarioId?: string;
  createdAtLocal: string; // ISO
  payload: T;
}

export interface SyncPushRequest {
  items: SyncEnvelope[];
}

export interface SyncItemResult {
  id: string;
  idempotencyKey: string;
  estado: SyncStatus;
  error?: string;
}

export interface SyncPushResponse {
  resultados: SyncItemResult[];
  serverTime: string;
}

export interface SyncPullQuery {
  sucursalId: string;
  since?: string; // cursor ISO, omitir para sync completo inicial
}

export interface SyncChange<T = unknown> {
  entidad: SyncEntidad;
  operacion: SyncOperacion;
  id: string;
  payload: T;
  updatedAtServer: string;
}

export interface SyncPullResponse {
  cambios: SyncChange[];
  cursor: string; // usar en el próximo `since`
}

/** Eventos de WebSocket (namespace /realtime). Salas: `sucursal:{id}`, `empresa:{id}`,
 *  `estacion:{estacionCocinaId}`, `usuario:{id}` (para notificaciones dirigidas). */
export const WS_EVENTS = {
  PEDIDO_CREADO: "pedido:creado",
  PEDIDO_ACTUALIZADO: "pedido:actualizado",
  PEDIDO_ITEM_ACTUALIZADO: "pedido_item:actualizado",
  MESA_ACTUALIZADA: "mesa:actualizada",
  COMANDA_NUEVA: "comanda:nueva",
  COMANDA_LISTA: "comanda:lista",
  INVENTARIO_ALERTA: "inventario:alerta",
  SYNC_ESTADO_SUCURSAL: "sync:estado_sucursal",
  /** El software de PC lo emite a TODOS los sockets justo antes de apagar el backend embebido
   *  (ver electron/backend-manager.ts -> POST /realtime/anunciar-cierre) — le da a la app de
   *  Meseros la oportunidad de mostrar "Software cerrado" de inmediato, en vez de esperar a que
   *  el heartbeat de transporte detecte la caída por timeout. Un cierre forzado (proceso
   *  terminado, apagón, red caída) NO pasa por aquí — lo detecta solo el heartbeat. */
  SERVIDOR_CERRANDO: "servidor:cerrando",
  /** Emitido al mesero (`usuario:{meseroId}`) y a la sucursal (para el POS) al crear una
   *  solicitud de pago con tarjeta — ver PagosService.crearSolicitud(). */
  PAGO_SOLICITADO: "pago:solicitado",
  /** Emitido en cada transición de estado de una solicitud de pago (ENVIADO_A_TERMINAL,
   *  APROBADO, RECHAZADO, etc.) — a la misma sucursal y al mesero asignado. */
  PAGO_ACTUALIZADO: "pago:actualizado",
} as const;

export type WsEventName = (typeof WS_EVENTS)[keyof typeof WS_EVENTS];

/**
 * Venta cerrada (cobrada o cancelada) de un POS de Windows en modo standalone, tal como la sube
 * al ERP en la nube (SyncEntidad.VENTA_HUB). Es un snapshot completo con los ids YA traducidos a
 * los de la nube (ver enlace-nube en el backend): el ERP la importa respetando los totales, la
 * fecha y el folio originales, sin recalcular precios ni volver a descontar inventario — lo que
 * se cobró en el mostrador es lo que vale.
 */
export interface VentaHub {
  folioLocal: string;
  estado: "COBRADO" | "CANCELADO";
  /** Hora real de la venta en el POS (ISO). */
  creadaEn: string;
  tipo: string;
  canalOrigen: string;
  numComensales?: number | null;
  notasGenerales?: string | null;
  subtotal: number;
  impuesto: number;
  descuentoTotal: number;
  total: number;
  meseroId?: string | null;
  cajeroId?: string | null;
  /** Equipo donde nació la venta (el POS o la tablet de un mesero), si se conoce. */
  dispositivoOrigen?: { identificador: string; nombre: string; tipo: string } | null;
  items: {
    id: string;
    productoId: string;
    cantidad: number;
    precioUnitario: number;
    notas?: string | null;
    modificadores: { id: string; opcionModificadorId: string; precioExtra: number }[];
  }[];
  pagos: { id: string; metodo: string; monto: number; referencia?: string | null; usuarioId?: string | null }[];
  descuentos: { id: string; tipo: string; valor: number; montoAplicado: number; motivo: string; autorizadoPorId?: string | null }[];
}
