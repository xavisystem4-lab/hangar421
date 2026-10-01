import { erpFetch } from "../api/erpHttp";
import type { MapeoItem, PedidoEntrante, PedidoErp } from "./ventaPlataforma";

/**
 * Endpoints /plataformas/* del ERP en la nube — los mismos que usan el POS de Windows
 * (screens/admin/AdminPlataformas.tsx) y el CRM web. Requieren rol de administrador y conexión:
 * a diferencia de la venta de mostrador, aquí no hay modo offline posible, porque los pedidos
 * llegan al ERP por el webhook de cada plataforma.
 */

export type CodigoPlataforma = "didi" | "uber" | "rappi";
export type Ambiente = "SANDBOX" | "PRODUCCION";
export type EstadoConexion = "CONECTADA" | "DESCONECTADA" | "PENDIENTE_CONFIGURACION" | "ERROR";

export interface PlataformaConfig {
  id: string | null;
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
}

const json = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export const plataformasApi = {
  listarConfiguraciones: (empresaId: string) =>
    erpFetch<PlataformaConfig[]>(`/plataformas/configuraciones?empresaId=${encodeURIComponent(empresaId)}`),
  guardarConfiguracion: (plataforma: CodigoPlataforma, datos: GuardarConfigPlataforma) =>
    erpFetch<PlataformaConfig>(`/plataformas/configuraciones/${plataforma}`, json(datos)),
  probarConexion: (configId: string) =>
    erpFetch<{ ok: boolean; detalle: string }>(`/plataformas/configuraciones/${configId}/probar-conexion`, { method: "POST" }),
  reconectar: (configId: string) =>
    erpFetch<{ ok: boolean; detalle: string }>(`/plataformas/configuraciones/${configId}/reconectar`, { method: "POST" }),
  desconectar: (configId: string) => erpFetch<unknown>(`/plataformas/configuraciones/${configId}/desconectar`, { method: "POST" }),
  regenerarWebhook: (configId: string) => erpFetch<unknown>(`/plataformas/configuraciones/${configId}/regenerar-webhook`, { method: "POST" }),

  /** Solo los que esperan decisión (RECIBIDA). */
  listarPedidosPorAceptar: (empresaId: string) =>
    erpFetch<PedidoEntrante[]>(`/plataformas/pedidos?empresaId=${encodeURIComponent(empresaId)}&estado=RECIBIDA`),
  aceptarPedido: (
    ordenId: string,
    datos: { sucursalId: string; items: MapeoItem[]; pedidoId: string; turnoId?: string; meseroId?: string; dispositivoId?: string },
  ) =>
    erpFetch<PedidoErp>(
      `/plataformas/pedidos/${ordenId}/aceptar`,
      json({
        ...datos,
        items: datos.items.map((m) => ({ productoId: m.productoId, cantidad: m.cantidad, notas: m.notas.trim() || undefined })),
      }),
    ),
  rechazarPedido: (ordenId: string, motivo: string) => erpFetch<PedidoEntrante>(`/plataformas/pedidos/${ordenId}/rechazar`, json({ motivo })),
};

/** Mensaje legible de un error del ERP (class-validator a veces manda `message` como lista). */
export function mensajeError(e: any, porDefecto: string): string {
  const m = e?.cuerpo?.message ?? e?.message;
  if (Array.isArray(m)) return m.join("\n");
  if (e?.status === 403) return "Tu usuario no tiene permiso para administrar plataformas (requiere administrador).";
  return typeof m === "string" && m ? m : porDefecto;
}
