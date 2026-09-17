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
 * Adaptador de DiDi Food. NO se verificó contra documentación oficial de DiDi (a diferencia de
 * `mercadopago.adapter.ts`) porque este PR no tiene acceso a credenciales/documentación de
 * partner — cada punto marcado TODO(real-api) debe confirmarse antes de habilitar producción.
 * La forma general (llamada HTTP real con timeout+reintentos, verificación de firma HMAC sobre
 * el body del webhook) sí sigue el mismo patrón que el resto del repo.
 */
@Injectable()
export class DidiAdapter implements PlataformaDeliveryAdapter {
  readonly codigo = "didi";
  readonly nombreVisible = "DiDi Food";
  private readonly logger = new Logger(DidiAdapter.name);

  constructor(private readonly config: ConfigService) {}

  validarConfiguracion(credenciales: CredencialesPlataforma): void {
    if (!credenciales.extra.apiKey) {
      throw new Error("Falta el API Key / Client ID de DiDi");
    }
    if (!credenciales.extra.clientSecret) {
      throw new Error("Falta el Client Secret de DiDi — sin esto no se pueden verificar los webhooks entrantes");
    }
    if (!credenciales.identificadorTienda) {
      throw new Error("Falta el id de tienda/restaurante de DiDi");
    }
  }

  campoPrincipalEnmascarado(credenciales: CredencialesPlataforma): string {
    return credenciales.extra.apiKey.slice(-4);
  }

  tieneClientSecret(credenciales: CredencialesPlataforma): boolean {
    return Boolean(credenciales.extra.clientSecret);
  }

  async probarConexion(credenciales: CredencialesPlataforma): Promise<ResultadoPruebaConexionPlataforma> {
    // TODO(real-api): confirmar el endpoint real de "salud"/autenticación contra la
    // documentación oficial de partner de DiDi Food antes de habilitar PRODUCCION — hoy solo se
    // valida que el host configurado responda con las credenciales dadas.
    const baseUrl = this.config.get<string>("DIDI_API_BASE_URL");
    if (!baseUrl) {
      return { ok: false, detalle: "DIDI_API_BASE_URL no está configurado en el backend" };
    }
    try {
      const res = await fetchConReintentos(`${baseUrl}/ping`, {
        headers: { Authorization: `Bearer ${credenciales.extra.apiKey}`, "Content-Type": "application/json" },
      });
      if (!res.ok) {
        return { ok: false, detalle: `DiDi respondió ${res.status}` };
      }
      return { ok: true, detalle: "Conexión con DiDi verificada" };
    } catch (e: any) {
      this.logger.error(`Error al probar conexión con DiDi: ${e.message}`);
      return { ok: false, detalle: e.message ?? "No se pudo conectar con DiDi" };
    }
  }

  async procesarWebhook(
    credenciales: CredencialesPlataforma,
    peticion: { headers: Record<string, string>; query: Record<string, string>; body: unknown },
  ): Promise<WebhookProcesadoPlataforma> {
    this.verificarFirma(credenciales, peticion);

    // TODO(real-api): confirmar los nombres de campo reales del payload de webhook de DiDi Food
    // (id de evento, id de orden, tipo de evento, estado, cliente, total, items) contra la
    // documentación oficial — los nombres usados aquí son un supuesto razonable, no una
    // confirmación. Sin esto confirmado, los pedidos entrantes de DiDi pueden llegar con el
    // cliente/total/items vacíos aunque la orden sí se detecte (ver `items` abajo).
    const body = (peticion.body ?? {}) as Record<string, any>;
    const eventoExternoId = body.event_id ?? body.eventId;
    if (!eventoExternoId) {
      throw new Error("Webhook de DiDi sin id de evento reconocible");
    }

    const ordenExternaId = body.order_id ?? body.orderId;
    if (!ordenExternaId) {
      return { eventoExternoId: String(eventoExternoId), orden: null };
    }

    const itemsExternos = Array.isArray(body.items) ? body.items : Array.isArray(body.products) ? body.products : [];
    const items = itemsExternos.map((it: any) => ({
      nombreExterno: it.name ?? it.title ?? "Producto sin nombre",
      cantidad: Number(it.quantity ?? it.qty ?? 1),
      precioUnitario: it.price !== undefined ? Number(it.price) : undefined,
    }));

    return {
      eventoExternoId: String(eventoExternoId),
      orden: {
        ordenExternaId: String(ordenExternaId),
        tipoEvento: body.event_type ?? body.eventType ?? "desconocido",
        estadoExterno: body.status ?? "desconocido",
        clienteNombre: body.customer?.name ?? body.customerName ?? null,
        total: body.total !== undefined ? Number(body.total) : null,
        items,
        payloadSanitizado: { orderId: ordenExternaId, eventType: body.event_type ?? body.eventType, status: body.status, items },
      },
    };
  }

  /** Esquema genérico: HMAC-SHA256 del body crudo con el clientSecret como llave, comparado en
   *  tiempo constante contra un header de firma. TODO(real-api): confirmar el nombre exacto del
   *  header y el algoritmo de firma de DiDi Food contra su documentación de partner antes de
   *  habilitar PRODUCCION — este es el mismo patrón usado por Mercado Pago/Uber, no una
   *  confirmación de que DiDi lo implemente igual. */
  private verificarFirma(
    credenciales: CredencialesPlataforma,
    peticion: { headers: Record<string, string>; body: unknown },
  ) {
    const firmaRecibida = peticion.headers["x-didi-signature"];
    if (!firmaRecibida) throw new Error("Webhook de DiDi sin firma (x-didi-signature) — rechazado");

    const cuerpo = typeof peticion.body === "string" ? peticion.body : JSON.stringify(peticion.body ?? {});
    const esperada = createHmac("sha256", credenciales.extra.clientSecret).update(cuerpo).digest("hex");
    const a = Buffer.from(esperada);
    const b = Buffer.from(firmaRecibida);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new Error("Firma de webhook de DiDi inválida — rechazado");
    }
  }
}
