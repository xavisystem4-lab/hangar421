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

const AUTH_PROD = "https://rests-integrations.auth0.com/oauth/token";
const AUTH_DEV = "https://rests-integrations-dev.auth0.com/oauth/token";
const API_PROD_MX = "https://services.mxgrability.rappi.com";
const API_DEV = "https://api.dev.rappi.com";

/**
 * Rappi — Developer Portal (https://dev-portal.rappi.com/es/), consultado el 06-oct-2026:
 *  - Credenciales (client_id/client_secret) las entrega el equipo de integraciones de Rappi
 *    (TAM) durante el proceso de integración y homologación. No es autoservicio.
 *  - Token OAuth2 client_credentials vía Auth0 (rests-integrations[-dev].auth0.com); se manda
 *    en el header `x-authorization: bearer …`.
 *  - Webhook firmado con `Rappi-Signature: t=<timestamp>,sign=<hex>` =
 *    HMAC-SHA256(secreto del webhook, `${t}.${body crudo}`).
 *  - Aceptar: PUT {dominio país}/restaurants/orders/v1/stores/{storeId}/orders/{orderId}/take.
 *  - Rappi cancela por expiración si no se acepta/rechaza en ~4 minutos.
 *
 * NO verificado de punta a punta: el `audience` de Auth0 y la forma exacta del payload de
 * NEW_ORDER deben confirmarse en el ambiente de desarrollo de Rappi. Rechazar NO se implementa
 * contra la API (el tipo de cancelación válido no está confirmado): se registra como MANUAL.
 */
@Injectable()
export class RappiAdapter implements PlataformaDeliveryAdapter {
  readonly codigo = "rappi";
  readonly nombreVisible = "Rappi";
  private readonly logger = new Logger(RappiAdapter.name);
  private readonly tokens = new CacheTokens();

  constructor(private readonly config: ConfigService) {}

  validarConfiguracion(credenciales: CredencialesPlataforma): void {
    if (!credenciales.extra.clientId) throw new Error("Falta el Client ID de Rappi");
    if (!credenciales.extra.clientSecret) throw new Error("Falta el Client Secret de Rappi");
    if (!credenciales.identificadorTienda) throw new Error("Falta el id de tienda de Rappi (store_id)");
  }

  campoPrincipalEnmascarado(credenciales: CredencialesPlataforma): string {
    return credenciales.extra.clientId.slice(-4);
  }

  tieneClientSecret(credenciales: CredencialesPlataforma): boolean {
    return Boolean(credenciales.extra.clientSecret);
  }

  async probarConexion(credenciales: CredencialesPlataforma): Promise<ResultadoPruebaConexionPlataforma> {
    try {
      this.tokens.invalidar(credenciales.extra.clientId);
      await this.token(credenciales);
      const aviso = credenciales.extra.webhookSecret ? "" : " Falta el secreto del webhook: sin él se rechazan los pedidos entrantes.";
      return { ok: true, detalle: `Rappi aceptó las credenciales (token obtenido).${aviso}` };
    } catch (e: any) {
      return { ok: false, detalle: e?.message ?? "No se pudo conectar con Rappi" };
    }
  }

  async procesarWebhook(credenciales: CredencialesPlataforma, peticion: PeticionWebhook): Promise<WebhookProcesadoPlataforma> {
    const secreto = credenciales.extra.webhookSecret;
    if (!secreto) throw new Error("Falta el secreto del webhook de Rappi en la configuración — rechazado");
    const cabecera = peticion.headers["rappi-signature"];
    if (!cabecera) throw new Error("Webhook de Rappi sin firma (Rappi-Signature) — rechazado");
    const partes = Object.fromEntries(
      cabecera.split(",").map((p) => {
        const i = p.indexOf("=");
        return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
      }),
    );
    if (!partes.t || !partes.sign) throw new Error("Firma de Rappi mal formada — rechazado");
    const esperada = createHmac("sha256", secreto).update(`${partes.t}.${cuerpoParaFirma(peticion)}`).digest("hex");
    if (!firmasIguales(esperada, partes.sign)) throw new Error("Firma de webhook de Rappi inválida — rechazado");

    const body = (peticion.body ?? {}) as Record<string, any>;
    const detalle = body.order_detail ?? body.order ?? body;
    const evento = String(body.event ?? body.event_type ?? peticion.query?.event ?? (detalle?.order_id ? "NEW_ORDER" : "PING"));
    const ordenExternaId = detalle?.order_id ?? body.order_id;
    // Rappi no manda un id de evento propio: evento + orden + timestamp firmado lo hacen único,
    // y un reenvío idéntico (mismo t) choca con el índice de idempotencia.
    const eventoExternoId = `${evento}:${ordenExternaId ?? "-"}:${partes.t}`;
    if (!ordenExternaId) return { eventoExternoId, orden: null };

    const cancelada = /CANCEL/i.test(evento);
    const mapeado = cancelada ? {} : mapearOrdenRappi(body);
    return {
      eventoExternoId,
      orden: {
        ordenExternaId: String(ordenExternaId),
        tipoEvento: evento,
        estadoExterno: cancelada ? "CANCELED" : String(detalle?.state ?? detalle?.status ?? "SENT"),
        cancelada,
        ...mapeado,
        payloadSanitizado: { orderId: ordenExternaId, eventType: evento, ...(cancelada ? {} : (mapeado as any).payloadSanitizado) },
      },
    };
  }

  async aceptarOrden(credenciales: CredencialesPlataforma, ordenExternaId: string): Promise<ResultadoAccionPlataforma> {
    try {
      const token = await this.token(credenciales);
      const tienda = encodeURIComponent(credenciales.identificadorTienda ?? "");
      const res = await fetchConReintentos(
        `${this.urlApi(credenciales)}/restaurants/orders/v1/stores/${tienda}/orders/${encodeURIComponent(ordenExternaId)}/take`,
        { method: "PUT", headers: { "x-authorization": `bearer ${token}`, "Content-Type": "application/json" } },
        { reintentos: 1 },
      );
      if (res.status === 401) this.tokens.invalidar(credenciales.extra.clientId);
      if (!res.ok) return { ok: false, detalle: mensajeErrorHttp("Rappi", res.status, "aceptar la orden") };
      return { ok: true, detalle: "Rappi confirmó la orden." };
    } catch (e: any) {
      return { ok: false, detalle: e?.message?.startsWith("Rappi") || e?.message?.startsWith("No se pudo") ? e.message : mensajeErrorRed("Rappi", e) };
    }
  }

  // Sin rechazarOrden: ver comentario de la clase.

  private urlApi(credenciales: CredencialesPlataforma) {
    const env = this.config.get<string>("RAPPI_API_BASE_URL");
    return (env || (credenciales.ambiente === "PRODUCCION" ? API_PROD_MX : API_DEV)).replace(/\/$/, "");
  }

  private async token(credenciales: CredencialesPlataforma): Promise<string> {
    return this.tokens.obtener(credenciales.extra.clientId, async () => {
      const url = this.config.get<string>("RAPPI_AUTH_URL") || (credenciales.ambiente === "PRODUCCION" ? AUTH_PROD : AUTH_DEV);
      const audience = this.config.get<string>("RAPPI_AUTH_AUDIENCE");
      if (!audience) throw new Error("Falta RAPPI_AUTH_AUDIENCE en el servidor: es el 'audience' que Rappi indica al entregar las credenciales.");
      let res: Response;
      try {
        res = await fetchConReintentos(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: credenciales.extra.clientId,
            client_secret: credenciales.extra.clientSecret,
            audience,
            grant_type: "client_credentials",
          }),
        });
      } catch (e) {
        throw new Error(mensajeErrorRed("Rappi", e));
      }
      if (!res.ok) throw new Error(mensajeErrorHttp("Rappi", res.status, "el inicio de sesión"));
      const json = (await res.json()) as { access_token?: string; expires_in?: number };
      if (!json.access_token) throw new Error("Rappi no devolvió un token de acceso.");
      return { token: json.access_token, expiraEnSegundos: json.expires_in ?? 86400 };
    });
  }
}

/** Payload de NEW_ORDER → forma normalizada. Defensivo: la forma exacta debe confirmarse en el
 *  ambiente de desarrollo de Rappi. Sin teléfono ni dirección del cliente. */
export function mapearOrdenRappi(body: any): Partial<OrdenExternaEntrante> & { payloadSanitizado: Record<string, unknown> } {
  const d = body?.order_detail ?? body?.order ?? body ?? {};
  const items: ItemOrdenExterna[] = (Array.isArray(d.items) ? d.items : []).map((it: any) => ({
    nombreExterno: String(it.name ?? it.product_name ?? "Producto sin nombre"),
    cantidad: Number(it.quantity ?? 1),
    precioUnitario: numeroONull(it.unit_price_with_discount ?? it.price) ?? undefined,
    notas: it.comments || it.comment || undefined,
    modificadores: (Array.isArray(it.subitems) ? it.subitems : Array.isArray(it.toppings) ? it.toppings : [])
      .map((m: any) => (Number(m.quantity ?? 1) > 1 ? `${m.quantity}× ${m.name}` : String(m.name ?? "")))
      .filter(Boolean),
  }));
  const totales = d.totals ?? {};
  const entrega = {
    tipo: d.delivery_method ?? null,
    repartidor: body?.storekeeper?.name ?? null,
    horaEstimada: d.delivery_information?.estimated_time ?? null,
    codigoEntrega: d.handoff_code ?? null,
  };
  const montos = {
    subtotal: numeroONull(totales.total_products_with_discount ?? totales.total_products),
    envio: numeroONull(totales.charges?.shipping),
    propina: numeroONull(totales.tip),
    descuento: numeroONull(totales.total_discounts),
  };
  return {
    folioCorto: d.order_id ? String(d.order_id).slice(-6) : null,
    clienteNombre: body?.customer?.first_name ?? null,
    total: numeroONull(totales.total_order ?? totales.total),
    notas: d.comments || null,
    items,
    entrega,
    montos,
    payloadSanitizado: { items, entrega, montos, notas: d.comments || null },
  };
}
