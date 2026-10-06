import { erpFetch } from "../api/erpHttp";
import type { MapeoItem, PedidoEntrante, PedidoErp } from "./ventaPlataforma";

/**
 * Endpoints /plataformas/* del ERP en la nube — los mismos que usan el POS de Windows
 * (screens/admin/AdminPlataformas.tsx) y el CRM web. Requieren conexión: los pedidos llegan al
 * ERP por el webhook de cada plataforma, no hay modo offline posible. Configurar exige rol de
 * administrador; ver/aceptar/rechazar pedidos también lo puede hacer caja o supervisión.
 * La empresa la toma el ERP del token (el `empresaId` del query se ignora en el servidor).
 */

export type CodigoPlataforma = "didi" | "uber" | "rappi";
export type Ambiente = "SANDBOX" | "PRODUCCION";
export type EstadoConexion = "CONECTADA" | "DESCONECTADA" | "PENDIENTE_CONFIGURACION" | "ERROR";

export interface PlataformaConfig {
  id: string | null;
  /** null = cuenta de toda la empresa. */
  sucursalId?: string | null;
  plataforma: string;
  nombreVisible: string;
  ambiente: Ambiente;
  activo: boolean;
  estadoConexion: EstadoConexion;
  identificadorTienda: string | null;
  credencialesUltimos4: string | null;
  clientSecretConfigurado: boolean;
  webhookUrl: string | null;
  ultimaSincronizacion: string | null;
  ultimoErrorMensaje: string | null;
  ultimoErrorEn: string | null;
  pedidosRecibidos: number;
  pedidosSincronizados: number;
}

export interface GuardarConfigPlataforma {
  ambiente: Ambiente;
  identificadorTienda: string;
  activo: boolean;
  credenciales: Record<string, string>;
  /** null/omitido = cuenta de toda la empresa; un id = cuenta propia de esa sucursal. */
  sucursalId?: string | null;
}

export type FiltroEstadoPedido = "RECIBIDA" | "SINCRONIZADA" | "IGNORADA" | "CANCELADA" | "TODOS";

export interface FiltrosPedidos {
  estado?: FiltroEstadoPedido;
  plataforma?: CodigoPlataforma | null;
  sucursalId?: string | null;
  limite?: number;
}

export interface ErrorSincronizacion {
  id: string;
  plataforma: string;
  motivo: string;
  createdAt: string;
}

const consulta = (params: Record<string, string | number | null | undefined>) =>
  Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");

const json = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export const plataformasApi = {
  listarConfiguraciones: (empresaId: string, sucursalId?: string | null) =>
    erpFetch<PlataformaConfig[]>(`/plataformas/configuraciones?${consulta({ empresaId, sucursalId })}`),
  guardarConfiguracion: (plataforma: CodigoPlataforma, datos: GuardarConfigPlataforma) =>
    erpFetch<PlataformaConfig>(`/plataformas/configuraciones/${plataforma}`, json(datos)),
  probarConexion: (configId: string) =>
    erpFetch<{ ok: boolean; detalle: string }>(`/plataformas/configuraciones/${configId}/probar-conexion`, { method: "POST" }),
  reconectar: (configId: string) =>
    erpFetch<{ ok: boolean; detalle: string }>(`/plataformas/configuraciones/${configId}/reconectar`, { method: "POST" }),
  desconectar: (configId: string) => erpFetch<unknown>(`/plataformas/configuraciones/${configId}/desconectar`, { method: "POST" }),
  regenerarWebhook: (configId: string) => erpFetch<unknown>(`/plataformas/configuraciones/${configId}/regenerar-webhook`, { method: "POST" }),

  /** Solo los que esperan decisión (RECIBIDA). */
  listarPedidosPorAceptar: (empresaId: string, sucursalId?: string | null) =>
    erpFetch<PedidoEntrante[]>(`/plataformas/pedidos?${consulta({ empresaId, estado: "RECIBIDA", sucursalId })}`),
  /** Bandeja con filtros: pendientes, historial (aceptados/rechazados/cancelados) o todos. */
  listarPedidos: (empresaId: string, filtros: FiltrosPedidos = {}) =>
    erpFetch<PedidoEntrante[]>(
      `/plataformas/pedidos?${consulta({ empresaId, estado: filtros.estado ?? "RECIBIDA", plataforma: filtros.plataforma, sucursalId: filtros.sucursalId, limite: filtros.limite })}`,
    ),
  /** Webhooks rechazados (firma inválida, integración desactivada…). */
  listarErroresSincronizacion: () => erpFetch<ErrorSincronizacion[]>("/plataformas/eventos/errores?limite=30"),
  /** Pedido de PRUEBA (solo integraciones en ambiente de Pruebas). Nunca toca la plataforma. */
  simularPedido: (plataforma: CodigoPlataforma, sucursalId?: string | null) =>
    erpFetch<PedidoEntrante>("/plataformas/pedidos/simular", json({ plataforma, sucursalId: sucursalId ?? undefined })),
  aceptarPedido: (
    ordenId: string,
    datos: { sucursalId: string; items: MapeoItem[]; pedidoId: string; turnoId?: string; meseroId?: string; dispositivoId?: string; confirmarManual?: boolean },
  ) =>
    erpFetch<PedidoErp>(
      `/plataformas/pedidos/${ordenId}/aceptar`,
      json({
        ...datos,
        items: datos.items.map((m) => ({ productoId: m.productoId, cantidad: m.cantidad, notas: m.notas.trim() || undefined })),
      }),
    ),
  rechazarPedido: (ordenId: string, motivo: string, confirmarManual = false) =>
    erpFetch<PedidoEntrante>(`/plataformas/pedidos/${ordenId}/rechazar`, json({ motivo, confirmarManual })),
};

/** El ERP respondió que la plataforma no puede confirmar por API: hay que hacerlo en su tablet
 *  y confirmarlo a mano (ver PlataformasService.confirmarEnPlataforma). */
export function requiereConfirmacionManual(e: any): boolean {
  return e?.status === 409 && (e?.cuerpo?.codigo === "CONFIRMACION_MANUAL_REQUERIDA" || /confirma aquí/.test(String(e?.message ?? "")));
}

/** Mensaje legible de un error del ERP (class-validator a veces manda `message` como lista). */
export function mensajeError(e: any, porDefecto: string): string {
  const m = e?.cuerpo?.message ?? e?.message;
  if (Array.isArray(m)) return m.join("\n");
  const texto = typeof m === "string" ? m : "";
  // El 403 genérico del guard de roles ("Forbidden resource") no le dice nada al cajero.
  if (e?.status === 403 && (!texto || /forbidden/i.test(texto))) return "Tu usuario no tiene permiso para esta acción de Delivery.";
  return texto || porDefecto;
}
