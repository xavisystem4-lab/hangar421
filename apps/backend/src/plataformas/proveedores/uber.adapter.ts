import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac, timingSafeEqual } from "crypto";
import { fetchConReintentos } from "../../common/http/fetch-con-reintentos";
import {
  CredencialesPlataforma,
  PlataformaDeliveryAdapter,
  ResultadoPruebaConexionPlataforma,
  WebhookProcesadoPlataforma,
} from "./plataforma-delivery.interface";

/**
 * Adaptador de Uber (Eats/Direct). NO se verificó contra documentación oficial de Uber en este
 * PR — cada punto marcado TODO(real-api) debe confirmarse antes de habilitar producción,
 * incluyendo cuál producto (Marketplace API vs Direct) aplica, ya que difieren en flujo de
 * autenticación y forma del webhook. El esquema de firma de webhook (X-Uber-Signature,
 * HMAC-SHA256 sobre el body crudo) es el que Uber documenta públicamente hoy, pero debe
 * re-verificarse contra la documentación vigente antes de confiar en tráfico real.
 */
@Injectable()
export class UberAdapter implements PlataformaDeliveryAdapter {
  readonly codigo = "uber";
  readonly nombreVisible = "Uber Eats";
  private readonly logger = new Logger(UberAdapter.name);

  constructor(private readonly config: ConfigService) {}

  validarConfiguracion(credenciales: CredencialesPlataforma): void {
    if (!credenciales.extra.clientId) {
      throw new Error("Falta el Client ID de Uber");
    }
    if (!credenciales.extra.clientSecret) {
      throw new Error("Falta el Client Secret de Uber — sin esto no se pueden verificar los webhooks entrantes");
    }
    if (!credenciales.identificadorTienda) {
      throw new Error("Falta el id de tienda de Uber (store_id)");
    }
  }

  campoPrincipalEnmascarado(credenciales: CredencialesPlataforma): string {
    return credenciales.extra.clientId.slice(-4);
  }

  tieneClientSecret(credenciales: CredencialesPlataforma): boolean {
    return Boolean(credenciales.extra.clientSecret);
  }

  async probarConexion(credenciales: CredencialesPlataforma): Promise<ResultadoPruebaConexionPlataforma> {
    // TODO(real-api): Uber usa OAuth2 client-credentials — este PR no implementa el intercambio
    // real de token; confirmar el endpoint de token (`/oauth/v2/token` en la doc pública, a
    // reverificar) y el scope necesario antes de habilitar PRODUCCION.
    const baseUrl = this.config.get<string>("UBER_API_BASE_URL");
    if (!baseUrl) {
      return { ok: false, detalle: "UBER_API_BASE_URL no está configurado en el backend" };
    }
    try {
      const res = await fetchConReintentos(`${baseUrl}/ping`, {
        headers: { Authorization: `Bearer ${credenciales.extra.clientSecret}`, "Content-Type": "application/json" },
      });
      if (!res.ok) {
        return { ok: false, detalle: `Uber respondió ${res.status}` };
      }
      return { ok: true, detalle: "Conexión con Uber verificada" };
    } catch (e: any) {
      this.logger.error(`Error al probar conexión con Uber: ${e.message}`);
      return { ok: false, detalle: e.message ?? "No se pudo conectar con Uber" };
    }
  }

  async procesarWebhook(
    credenciales: CredencialesPlataforma,
    peticion: { headers: Record<string, string>; query: Record<string, string>; body: unknown },
  ): Promise<WebhookProcesadoPlataforma> {
    this.verificarFirma(credenciales, peticion);

    // TODO(real-api): confirmar los nombres de campo reales del payload de Uber Eats/Direct
    // (event_id, resource_href/order_id, event_type, status, cliente, total, items) contra la
    // documentación vigente. Sin esto confirmado, los pedidos entrantes de Uber pueden llegar con
    // el cliente/total/items vacíos aunque la orden sí se detecte (ver `items` abajo).
    const body = (peticion.body ?? {}) as Record<string, any>;
    const eventoExternoId = body.event_id ?? body.meta?.event_id;
    if (!eventoExternoId) {
      throw new Error("Webhook de Uber sin id de evento reconocible");
    }

    const ordenExternaId = body.order_id ?? body.resource_id;
    if (!ordenExternaId) {
      return { eventoExternoId: String(eventoExternoId), orden: null };
    }

    const itemsExternos = Array.isArray(body.cart?.items) ? body.cart.items : Array.isArray(body.items) ? body.items : [];
    const items = itemsExternos.map((it: any) => ({
      nombreExterno: it.title ?? it.name ?? "Producto sin nombre",
      cantidad: Number(it.quantity ?? 1),
      precioUnitario: it.price?.unit_price?.amount !== undefined ? Number(it.price.unit_price.amount) / 100 : undefined,
    }));

    return {
      eventoExternoId: String(eventoExternoId),
      orden: {
        ordenExternaId: String(ordenExternaId),
        tipoEvento: body.event_type ?? "desconocido",
        estadoExterno: body.status ?? "desconocido",
        clienteNombre: body.eater?.first_name ?? body.customer?.name ?? null,
        total: body.payment?.charges?.total?.amount !== undefined ? Number(body.payment.charges.total.amount) / 100 : null,
        items,
        payloadSanitizado: { orderId: ordenExternaId, eventType: body.event_type, status: body.status, items },
      },
    };
  }

  /** X-Uber-Signature: HMAC-SHA256 del body crudo con el client secret como llave — esquema
   *  públicamente documentado por Uber hoy; TODO(real-api) re-verificar contra la documentación
   *  vigente antes de habilitar PRODUCCION (Uber puede firmar con un "signing secret" distinto
   *  del client secret, según el producto). */
  private verificarFirma(
    credenciales: CredencialesPlataforma,
    peticion: { headers: Record<string, string>; body: unknown },
  ) {
    const firmaRecibida = peticion.headers["x-uber-signature"];
    if (!firmaRecibida) throw new Error("Webhook de Uber sin firma (x-uber-signature) — rechazado");

    const cuerpo = typeof peticion.body === "string" ? peticion.body : JSON.stringify(peticion.body ?? {});
    const esperada = createHmac("sha256", credenciales.extra.clientSecret).update(cuerpo).digest("hex");
    const a = Buffer.from(esperada);
    const b = Buffer.from(firmaRecibida);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new Error("Firma de webhook de Uber inválida — rechazado");
    }
  }
}
