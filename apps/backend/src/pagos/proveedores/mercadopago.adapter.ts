import { Injectable, Logger } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "crypto";
import {
  CredencialesProveedor,
  EstadoPagoConsultado,
  ProveedorPagoAdapter,
  ResultadoPruebaConexion,
  SolicitudPagoInput,
  SolicitudPagoResultado,
  TerminalExterna,
  WebhookProcesado,
} from "./proveedor-pago.interface";

const BASE_URL = "https://api.mercadopago.com";

/**
 * Adaptador de Mercado Pago Point Smart — usa la Orders API unificada (`/v1/orders`,
 * `type: "point"`), que es el método vigente y recomendado por Mercado Pago para crear cobros
 * remotos en una terminal Point ya vinculada (la API anterior, `point/integration-api/.../
 * payment-intents`, quedó como legacy). Verificado contra la documentación oficial de Mercado
 * Pago (developers.mercadopago.com) antes de implementar — no se adivinaron endpoints.
 *
 * Requiere que la terminal ya esté en modo PDV y vinculada a una tienda/caja desde el propio
 * dashboard de Mercado Pago (eso NO se puede hacer por API) — `identificadorExterno` en
 * PaymentTerminal debe ser el `terminal_id` que Mercado Pago le asigna en ese proceso.
 */
@Injectable()
export class MercadoPagoAdapter implements ProveedorPagoAdapter {
  readonly codigo = "mercadopago";
  private readonly logger = new Logger(MercadoPagoAdapter.name);

  validarConfiguracion(credenciales: CredencialesProveedor): void {
    if (!credenciales.extra.accessToken) {
      throw new Error("Falta accessToken en la configuración de Mercado Pago");
    }
    if (!credenciales.extra.webhookSecret) {
      throw new Error("Falta webhookSecret en la configuración de Mercado Pago — sin esto no se pueden verificar los webhooks entrantes");
    }
  }

  async listarTerminales(credenciales: CredencialesProveedor): Promise<TerminalExterna[]> {
    // GET /terminals/v1/list — según la documentación de Mercado Pago solo confirma soporte
    // explícito para NEWLAND_N950/PAX_A910; para Point Smart en modo PDV, en la práctica también
    // devuelve la terminal si ya quedó vinculada a una tienda/caja desde el dashboard de Mercado
    // Pago. Si no aparece aquí, Administración permite de todos modos capturar el
    // `identificadorExterno` (terminal_id) a mano.
    const res = await this.fetchMP(credenciales, "GET", "/terminals/v1/list");
    const terminales = (res?.data?.terminals ?? []) as Array<{ id: string; operating_mode: string }>;
    return terminales.map((t) => ({
      identificadorExterno: t.id,
      nombre: t.id,
      estadoConexion: t.operating_mode === "PDV" ? "CONECTADA" : "DESCONECTADA",
    }));
  }

  async crearSolicitudDePago(
    credenciales: CredencialesProveedor,
    input: SolicitudPagoInput,
  ): Promise<SolicitudPagoResultado> {
    const body = {
      type: "point",
      external_reference: input.referenciaInterna,
      // Ventana en la que el cobro debe capturarse en la terminal — nuestra propia expiración
      // de PaymentRequest (más holgada) es la que gobierna el estado en nuestra base; esta solo
      // limita cuánto tiempo queda "colgado" en la propia terminal si nadie lo atiende.
      expiration_time: "PT3M",
      description: input.descripcion ?? "Cobro HANGAR 421",
      transactions: { payments: [{ amount: input.importe.toFixed(2) }] },
      config: { point: { terminal_id: input.identificadorExternoTerminal } },
    };

    let res: any;
    try {
      res = await this.fetchMP(credenciales, "POST", "/v1/orders", body, { "X-Idempotency-Key": input.referenciaInterna });
    } catch (e: any) {
      return { referenciaExterna: "", estado: "ERROR", motivoError: e.message ?? "Error al crear la orden en Mercado Pago" };
    }

    return {
      referenciaExterna: res.id,
      estado: this.mapearEstadoOrden(res.status).estado === "ERROR" ? "ERROR" : "ENVIADO_A_TERMINAL",
    };
  }

  async cancelarSolicitudDePago(credenciales: CredencialesProveedor, referenciaExterna: string): Promise<void> {
    await this.fetchMP(credenciales, "POST", `/v1/orders/${referenciaExterna}/cancel`, {}, {
      "X-Idempotency-Key": `cancel-${referenciaExterna}`,
    });
  }

  async consultarEstadoDePago(credenciales: CredencialesProveedor, referenciaExterna: string): Promise<EstadoPagoConsultado> {
    const res = await this.fetchMP(credenciales, "GET", `/v1/orders/${referenciaExterna}`);
    const { estado, motivoError } = this.mapearEstadoOrden(res.status);
    return {
      estado,
      motivoError,
      payloadSanitizado: { id: res.id, status: res.status, transactions: this.sanearTransacciones(res.transactions) },
    };
  }

  async procesarWebhook(
    credenciales: CredencialesProveedor,
    peticion: { headers: Record<string, string>; query: Record<string, string>; body: unknown },
  ): Promise<WebhookProcesado> {
    this.verificarFirma(credenciales, peticion);

    const orderId = peticion.query["data.id"] ?? (peticion.body as any)?.data?.id;
    if (!orderId) {
      return { referenciaInterna: null, referenciaExterna: null, estado: "ERROR", motivoError: "Webhook sin data.id" };
    }

    // Nunca se confía en el estado que venga en el body del webhook — solo dispara "hay que
    // revisar esta orden"; el estado real siempre se relee de la API con el token propio.
    const res = await this.fetchMP(credenciales, "GET", `/v1/orders/${orderId}`);
    const { estado, motivoError } = this.mapearEstadoOrden(res.status);
    return {
      referenciaInterna: res.external_reference ?? null,
      referenciaExterna: res.id ?? orderId,
      estado,
      motivoError,
      payloadSanitizado: { id: res.id, status: res.status, transactions: this.sanearTransacciones(res.transactions) },
    };
  }

  async probarConexion(credenciales: CredencialesProveedor): Promise<ResultadoPruebaConexion> {
    try {
      await this.fetchMP(credenciales, "GET", "/terminals/v1/list?limit=1");
      return { ok: true, detalle: "Conexión con Mercado Pago verificada" };
    } catch (e: any) {
      return { ok: false, detalle: e.message ?? "No se pudo conectar con Mercado Pago" };
    }
  }

  /** Firma de webhooks de Mercado Pago: header `x-signature` = "ts=<epoch>,v1=<hmac_hex>";
   *  se recalcula HMAC-SHA256 sobre el "manifest" `id:{data.id};request-id:{x-request-id};ts:{ts};`
   *  (partes omitidas si el valor correspondiente viene vacío, data.id en minúsculas) usando el
   *  webhook secret como llave, y se compara en tiempo constante. Formato verificado contra el
   *  SDK oficial de Mercado Pago (sdk-go/pkg/webhook) — no es una adivinanza. */
  private verificarFirma(credenciales: CredencialesProveedor, peticion: { headers: Record<string, string>; query: Record<string, string> }) {
    const xSignature = peticion.headers["x-signature"];
    const xRequestId = peticion.headers["x-request-id"] ?? "";
    const dataId = (peticion.query["data.id"] ?? "").toLowerCase();
    if (!xSignature) throw new Error("Webhook de Mercado Pago sin x-signature — rechazado");

    const partes = Object.fromEntries(xSignature.split(",").map((p) => p.trim().split("=") as [string, string]));
    const ts = partes.ts;
    const v1 = partes.v1;
    if (!ts || !v1) throw new Error("x-signature de Mercado Pago mal formado — rechazado");

    let manifest = "";
    if (dataId) manifest += `id:${dataId};`;
    if (xRequestId) manifest += `request-id:${xRequestId};`;
    manifest += `ts:${ts};`;

    const esperado = createHmac("sha256", credenciales.extra.webhookSecret).update(manifest).digest("hex");
    const a = Buffer.from(esperado);
    const b = Buffer.from(v1);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new Error("Firma de webhook de Mercado Pago inválida — rechazado");
    }
  }

  private mapearEstadoOrden(status: string): { estado: EstadoPagoConsultado["estado"]; motivoError?: string } {
    switch (status) {
      case "created":
        return { estado: "ENVIADO_A_TERMINAL" };
      case "at_terminal":
      case "action_required":
        return { estado: "EN_PROCESO" };
      case "processed":
        return { estado: "APROBADO" };
      case "canceled":
        return { estado: "CANCELADO" };
      case "expired":
        return { estado: "ERROR", motivoError: "La orden expiró en Mercado Pago sin completarse" };
      case "failed":
        return { estado: "RECHAZADO", motivoError: "El pago fue rechazado por Mercado Pago" };
      default:
        this.logger.warn(`Estado de orden Mercado Pago no reconocido: ${status}`);
        return { estado: "EN_PROCESO" };
    }
  }

  /** Nunca deja pasar datos de tarjeta (PAN/CVV/vencimiento) al guardarse en PaymentEvent — solo
   *  ids y estados, que es todo lo que el resto del sistema necesita para auditoría. */
  private sanearTransacciones(transactions: any) {
    const pagos = transactions?.payments ?? [];
    return { payments: pagos.map((p: any) => ({ id: p.id, status: p.status, status_detail: p.status_detail })) };
  }

  private async fetchMP(
    credenciales: CredencialesProveedor,
    metodo: string,
    ruta: string,
    body?: unknown,
    headersExtra?: Record<string, string>,
  ): Promise<any> {
    const res = await fetch(`${BASE_URL}${ruta}`, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${credenciales.extra.accessToken}`,
        "Content-Type": "application/json",
        ...headersExtra,
      },
      body: body !== undefined && metodo !== "GET" ? JSON.stringify(body) : undefined,
    });
    const texto = await res.text();
    const json = texto ? JSON.parse(texto) : {};
    if (!res.ok) {
      this.logger.error(`Mercado Pago ${metodo} ${ruta} -> ${res.status}: ${texto}`);
      throw new Error(json?.message ?? `Mercado Pago respondió ${res.status}`);
    }
    return json;
  }
}
