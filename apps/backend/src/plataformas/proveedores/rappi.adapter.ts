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
 * Adaptador de Rappi. NO se verificó contra documentación oficial de Rappi en este PR — Rappi no
 * publica un esquema de firma de webhook de forma auto-documentada; cada punto marcado
 * TODO(real-api) debe confirmarse directamente con el equipo de integraciones de Rappi antes de
 * habilitar producción.
 */
@Injectable()
export class RappiAdapter implements PlataformaDeliveryAdapter {
  readonly codigo = "rappi";
  readonly nombreVisible = "Rappi";
  private readonly logger = new Logger(RappiAdapter.name);

  constructor(private readonly config: ConfigService) {}

  validarConfiguracion(credenciales: CredencialesPlataforma): void {
    if (!credenciales.extra.clientId) {
      throw new Error("Falta el Client ID de Rappi");
    }
    if (!credenciales.extra.clientSecret) {
      throw new Error("Falta el Client Secret de Rappi — sin esto no se pueden verificar los webhooks entrantes");
    }
    if (!credenciales.identificadorTienda) {
      throw new Error("Falta el id de tienda de Rappi (store_id)");
    }
  }

  campoPrincipalEnmascarado(credenciales: CredencialesPlataforma): string {
    return credenciales.extra.clientId.slice(-4);
  }

  tieneClientSecret(credenciales: CredencialesPlataforma): boolean {
    return Boolean(credenciales.extra.clientSecret);
  }

  async probarConexion(credenciales: CredencialesPlataforma): Promise<ResultadoPruebaConexionPlataforma> {
    // TODO(real-api): confirmar el endpoint real de autenticación/salud de la API de integraciones
    // de Rappi (requiere partnership comercial, no es self-serve) antes de habilitar PRODUCCION.
    const baseUrl = this.config.get<string>("RAPPI_API_BASE_URL");
    if (!baseUrl) {
      return { ok: false, detalle: "RAPPI_API_BASE_URL no está configurado en el backend" };
    }
    try {
      const res = await fetchConReintentos(`${baseUrl}/ping`, {
        headers: { Authorization: `Bearer ${credenciales.extra.clientSecret}`, "Content-Type": "application/json" },
      });
      if (!res.ok) {
        return { ok: false, detalle: `Rappi respondió ${res.status}` };
      }
      return { ok: true, detalle: "Conexión con Rappi verificada" };
    } catch (e: any) {
      this.logger.error(`Error al probar conexión con Rappi: ${e.message}`);
      return { ok: false, detalle: e.message ?? "No se pudo conectar con Rappi" };
    }
  }

  async procesarWebhook(
    credenciales: CredencialesPlataforma,
    peticion: { headers: Record<string, string>; query: Record<string, string>; body: unknown },
  ): Promise<WebhookProcesadoPlataforma> {
    this.verificarFirma(credenciales, peticion);

    // TODO(real-api): confirmar los nombres de campo reales del payload de webhook de Rappi (id
    // de evento, id de orden, tipo de evento, estado, cliente, total, items) directamente con su
    // equipo de integraciones — no hay documentación pública para verificarlos de antemano. Sin
    // esto confirmado, los pedidos entrantes de Rappi pueden llegar con el cliente/total/items
    // vacíos aunque la orden sí se detecte (ver `items` abajo).
    const body = (peticion.body ?? {}) as Record<string, any>;
    const eventoExternoId = body.event_id ?? body.eventId;
    if (!eventoExternoId) {
      throw new Error("Webhook de Rappi sin id de evento reconocible");
    }

    const ordenExternaId = body.order_id ?? body.orderId;
    if (!ordenExternaId) {
      return { eventoExternoId: String(eventoExternoId), orden: null };
    }

    const itemsExternos = Array.isArray(body.items) ? body.items : Array.isArray(body.products) ? body.products : [];
    const items = itemsExternos.map((it: any) => ({
      nombreExterno: it.name ?? it.product_name ?? "Producto sin nombre",
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

  /** Esquema genérico (mismo patrón que DiDi/Uber): HMAC-SHA256 del body crudo con el
   *  clientSecret como llave. TODO(real-api): Rappi no documenta públicamente su esquema de
   *  firma — confirmar directamente con su equipo de integraciones el nombre del header y el
   *  algoritmo antes de habilitar PRODUCCION. */
  private verificarFirma(
    credenciales: CredencialesPlataforma,
    peticion: { headers: Record<string, string>; body: unknown },
  ) {
    const firmaRecibida = peticion.headers["x-rappi-signature"];
    if (!firmaRecibida) throw new Error("Webhook de Rappi sin firma (x-rappi-signature) — rechazado");

    const cuerpo = typeof peticion.body === "string" ? peticion.body : JSON.stringify(peticion.body ?? {});
    const esperada = createHmac("sha256", credenciales.extra.clientSecret).update(cuerpo).digest("hex");
    const a = Buffer.from(esperada);
    const b = Buffer.from(firmaRecibida);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new Error("Firma de webhook de Rappi inválida — rechazado");
    }
  }
}
