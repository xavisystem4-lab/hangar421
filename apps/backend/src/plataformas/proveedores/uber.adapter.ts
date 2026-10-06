import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac } from "crypto";
import { fetchConReintentos } from "../../common/http/fetch-con-reintentos";
import {
  CredencialesPlataforma,
  ItemOrdenExterna,
  OrdenExternaEntrante,
  PeticionWebhook,
  PlataformaDeliveryAdapter,
  ResultadoAccionPlataforma,
  ResultadoPruebaConexionPlataforma,
  WebhookProcesadoPlataforma,
} from "./plataforma-delivery.interface";
import { CacheTokens, cuerpoParaFirma, firmasIguales, mensajeErrorHttp, mensajeErrorRed, numeroONull } from "./http-plataforma";

const URL_TOKEN_DEFAULT = "https://auth.uber.com/oauth/v2/token";
const URL_API_DEFAULT = "https://api.uber.com";
const SCOPES = "eats.order eats.store";

/**
 * Uber Eats — Marketplace APIs (https://developer.uber.com/docs/eats/introduction).
 *
 * Basado en la documentación oficial consultada el 06-oct-2026:
 *  - OAuth2 client_credentials contra auth.uber.com/oauth/v2/token, scopes eats.order/eats.store.
 *  - Webhook firmado con `X-Uber-Signature` = HMAC-SHA256 (hex, minúsculas) del body crudo, con
 *    el Client Secret como llave. Eventos: orders.notification (nueva), orders.cancel /
 *    orders.failure (cancelada). El webhook solo trae `meta.resource_id`; el detalle se pide a
 *    GET /v2/eats/order/{id}.
 *  - Aceptar: POST /v1/eats/orders/{id}/accept_pos_order · Rechazar: POST …/deny_pos_order.
 *  - Uber cancela sola la orden si no se acepta/rechaza en ~11.5 minutos.
 *
 * REQUISITO DE UBER: el acceso a estas APIs requiere que Uber apruebe la app y habilite los
 * scopes para la tienda. Sin eso el token se niega (401/403) y "Probar conexión" lo dice.
 * NO verificado de punta a punta con una tienda real o de prueba: los nombres de campo del
 * detalle de la orden deben confirmarse con la tienda de prueba de Uber antes de producción.
 */
@Injectable()
export class UberAdapter implements PlataformaDeliveryAdapter {
  readonly codigo = "uber";
  readonly nombreVisible = "Uber Eats";
  private readonly logger = new Logger(UberAdapter.name);
  private readonly tokens = new CacheTokens();

  constructor(private readonly config: ConfigService) {}

  validarConfiguracion(credenciales: CredencialesPlataforma): void {
    if (!credenciales.extra.clientId) throw new Error("Falta el Client ID de Uber");
    if (!credenciales.extra.clientSecret) {
      throw new Error("Falta el Client Secret de Uber — sin esto no se pueden verificar los webhooks entrantes");
    }
    if (!credenciales.identificadorTienda) throw new Error("Falta el id de tienda de Uber (store_id)");
  }

  campoPrincipalEnmascarado(credenciales: CredencialesPlataforma): string {
    return credenciales.extra.clientId.slice(-4);
  }

  tieneClientSecret(credenciales: CredencialesPlataforma): boolean {
    return Boolean(credenciales.extra.clientSecret);
  }

  /** Pedir un token SÍ valida las credenciales y la aprobación de la app (no un /ping inventado). */
  async probarConexion(credenciales: CredencialesPlataforma): Promise<ResultadoPruebaConexionPlataforma> {
    try {
      this.tokens.invalidar(credenciales.extra.clientId);
      await this.token(credenciales);
      return { ok: true, detalle: "Uber Eats aceptó las credenciales (token OAuth obtenido)." };
    } catch (e: any) {
      return { ok: false, detalle: e?.message ?? "No se pudo conectar con Uber Eats" };
    }
  }

  async procesarWebhook(credenciales: CredencialesPlataforma, peticion: PeticionWebhook): Promise<WebhookProcesadoPlataforma> {
    const firma = peticion.headers["x-uber-signature"];
    if (!firma) throw new Error("Webhook de Uber sin firma (X-Uber-Signature) — rechazado");
    const esperada = createHmac("sha256", credenciales.extra.clientSecret).update(cuerpoParaFirma(peticion)).digest("hex");
    if (!firmasIguales(esperada, firma)) throw new Error("Firma de webhook de Uber inválida — rechazado");

    const body = (peticion.body ?? {}) as Record<string, any>;
    const eventoExternoId = body.event_id;
    if (!eventoExternoId) throw new Error("Webhook de Uber sin event_id");

    const tipoEvento = String(body.event_type ?? "desconocido");
    const ordenExternaId = body.meta?.resource_id ?? body.order_id;
    if (!ordenExternaId || !tipoEvento.startsWith("orders.")) {
      return { eventoExternoId: String(eventoExternoId), orden: null };
    }

    const cancelada = tipoEvento === "orders.cancel" || tipoEvento === "orders.failure";
    const base: OrdenExternaEntrante = {
      ordenExternaId: String(ordenExternaId),
      tipoEvento,
      estadoExterno: String(body.meta?.status ?? (cancelada ? "CANCELED" : "desconocido")),
      cancelada,
      payloadSanitizado: { orderId: ordenExternaId, eventType: tipoEvento, status: body.meta?.status ?? null },
    };
    if (cancelada) return { eventoExternoId: String(eventoExternoId), orden: base };

    // El webhook solo avisa; el contenido de la orden se pide aparte. Si falla, la orden queda
    // en la bandeja sin artículos y con aviso — mejor que perderla.
    const detalle = await this.obtenerDetalle(credenciales, String(ordenExternaId)).catch((e) => {
      this.logger.warn(`No se pudo leer el detalle de la orden de Uber ${ordenExternaId}: ${e?.message}`);
      return null;
    });
    if (!detalle) {
      return {
        eventoExternoId: String(eventoExternoId),
        orden: { ...base, notas: "No se pudo leer el detalle en Uber — revísalo en la tablet de Uber Eats.", payloadSanitizado: { ...base.payloadSanitizado, items: [] } },
      };
    }
    return { eventoExternoId: String(eventoExternoId), orden: { ...base, ...detalle, payloadSanitizado: { ...base.payloadSanitizado, ...detalle.payloadSanitizado } } };
  }

  async aceptarOrden(credenciales: CredencialesPlataforma, ordenExternaId: string): Promise<ResultadoAccionPlataforma> {
    return this.accion(credenciales, `/v1/eats/orders/${encodeURIComponent(ordenExternaId)}/accept_pos_order`, { reason: "Aceptado desde el POS HANGAR 421" }, "aceptar la orden");
  }

  async rechazarOrden(credenciales: CredencialesPlataforma, ordenExternaId: string, motivo: string): Promise<ResultadoAccionPlataforma> {
    return this.accion(
      credenciales,
      `/v1/eats/orders/${encodeURIComponent(ordenExternaId)}/deny_pos_order`,
      { reason: { explanation: motivo.slice(0, 200), code: "OTHER" } },
      "rechazar la orden",
    );
  }

  // --- privados ---------------------------------------------------------------------------

  private urlApi() {
    return (this.config.get<string>("UBER_API_BASE_URL") || URL_API_DEFAULT).replace(/\/$/, "");
  }

  private async token(credenciales: CredencialesPlataforma): Promise<string> {
    return this.tokens.obtener(credenciales.extra.clientId, async () => {
      let res: Response;
      try {
        res = await fetchConReintentos(this.config.get<string>("UBER_AUTH_URL") || URL_TOKEN_DEFAULT, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: credenciales.extra.clientId,
            client_secret: credenciales.extra.clientSecret,
            grant_type: "client_credentials",
            scope: SCOPES,
          }).toString(),
        });
      } catch (e) {
        throw new Error(mensajeErrorRed("Uber Eats", e));
      }
      if (!res.ok) throw new Error(mensajeErrorHttp("Uber Eats", res.status, "el inicio de sesión"));
      const json = (await res.json()) as { access_token?: string; expires_in?: number };
      if (!json.access_token) throw new Error("Uber Eats no devolvió un token de acceso.");
      return { token: json.access_token, expiraEnSegundos: json.expires_in ?? 3600 };
    });
  }

  private async accion(credenciales: CredencialesPlataforma, ruta: string, cuerpo: unknown, descripcion: string): Promise<ResultadoAccionPlataforma> {
    try {
      const token = await this.token(credenciales);
      const res = await fetchConReintentos(
        `${this.urlApi()}${ruta}`,
        { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) },
        // Aceptar no es idempotente del lado de nuestro estado si la red corta a medias: un
        // solo reintento por 5xx/red; un 409 posterior se interpreta abajo.
        { reintentos: 1 },
      );
      if (res.status === 401) this.tokens.invalidar(credenciales.extra.clientId);
      if (!res.ok) return { ok: false, detalle: mensajeErrorHttp("Uber Eats", res.status, descripcion) };
      return { ok: true, detalle: "Uber Eats confirmó la operación." };
    } catch (e: any) {
      return { ok: false, detalle: e?.message?.startsWith("Uber") || e?.message?.startsWith("No se pudo") ? e.message : mensajeErrorRed("Uber Eats", e) };
    }
  }

  private async obtenerDetalle(credenciales: CredencialesPlataforma, ordenId: string): Promise<Partial<OrdenExternaEntrante> & { payloadSanitizado: Record<string, unknown> }> {
    const token = await this.token(credenciales);
    const res = await fetchConReintentos(
      `${this.urlApi()}/v2/eats/order/${encodeURIComponent(ordenId)}`,
      { headers: { Authorization: `Bearer ${token}` } },
      { timeoutMs: 5000, reintentos: 0 },
    );
    if (!res.ok) throw new Error(mensajeErrorHttp("Uber Eats", res.status, "leer la orden"));
    return mapearOrdenUber(await res.json());
  }
}

/** Detalle de GET /v2/eats/order/{id} → forma normalizada. Montos de Uber en centavos.
 *  Exportada para probarla sin red. NO incluye teléfono ni dirección del cliente. */
export function mapearOrdenUber(o: any): Partial<OrdenExternaEntrante> & { payloadSanitizado: Record<string, unknown> } {
  const centavos = (v: any) => (numeroONull(v) === null ? null : Number(v) / 100);
  const items: ItemOrdenExterna[] = (Array.isArray(o?.cart?.items) ? o.cart.items : []).map((it: any) => ({
    nombreExterno: String(it.title ?? "Producto sin nombre"),
    cantidad: Number(it.quantity ?? 1),
    precioUnitario: centavos(it.price?.unit_price?.amount) ?? undefined,
    notas: it.special_instructions || undefined,
    modificadores: (Array.isArray(it.selected_modifier_groups) ? it.selected_modifier_groups : [])
      .flatMap((g: any) => (Array.isArray(g.selected_items) ? g.selected_items : []))
      .map((m: any) => (Number(m.quantity ?? 1) > 1 ? `${m.quantity}× ${m.title}` : String(m.title)))
      .filter(Boolean),
  }));
  const cargos = o?.payment?.charges ?? {};
  const entrega = {
    tipo: o?.type ?? null,
    repartidor: o?.courier?.first_name ?? null,
    horaEstimada: o?.estimated_ready_for_pickup_at ?? null,
    codigoEntrega: o?.display_id ?? null,
  };
  const montos = {
    subtotal: centavos(cargos.sub_total?.amount),
    envio: centavos(cargos.delivery_fee?.amount),
    propina: centavos(cargos.tip?.amount),
    descuento: centavos(cargos.promotion?.amount),
  };
  return {
    folioCorto: o?.display_id ?? null,
    estadoExterno: o?.current_state ?? undefined,
    clienteNombre: o?.eater?.first_name ?? null,
    total: centavos(cargos.total?.amount),
    notas: o?.cart?.special_instructions || null,
    items,
    entrega,
    montos,
    payloadSanitizado: { items, folioCorto: o?.display_id ?? null, entrega, montos, notas: o?.cart?.special_instructions || null },
  };
}
