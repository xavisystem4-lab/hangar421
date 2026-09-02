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
} as const;

export type WsEventName = (typeof WS_EVENTS)[keyof typeof WS_EVENTS];
