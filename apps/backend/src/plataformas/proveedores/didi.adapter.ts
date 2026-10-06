import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash } from "crypto";
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
import { CacheTokens, cuerpoParaFirma, firmasIguales, mensajeErrorHttp, mensajeErrorRed, numeroONull, parsearJsonConEnterosLargos } from "./http-plataforma";

const URL_API_DEFAULT = "https://openapi.didi-food.com/v1";

/** Motivos de cancelación que acepta POST /order/order/cancel (reason_id). */
export const MOTIVOS_CANCELACION_DIDI = {
  AGOTADO: 1010,
  CERRADO: 1020,
  OCUPADO: 1030,
  SIN_SERVICIOS: 1040,
  CLIENTE: 1050,
  OTRO: 1080,
} as const;

/** Errores de la API de DiDi (campo `errno`, que llega con HTTP 200). */
const ERRORES_DIDI: Record<number, string> = {
  10002: "parámetros inválidos",
  10100: "no se pudo obtener el token de la tienda",
  10101: "la tienda no tiene token: revisa que esté vinculada a tu app en DiDi (app_shop_id)",
  10102: "el token de la tienda venció",
  14103: "no se pudo leer la app",
  14105: "el App ID no existe",
  14106: "el App Secret es incorrecto",
};

/**
 * DiDi Food Open Platform (https://developer.didi-food.com/es-419/openapi), consultada el
 * 06-oct-2026 (requiere NDA, registro y certificación de la empresa en el portal):
 *  - Credenciales: `app_id` + `app_secret` de la app (Application Management) y `app_shop_id`,
 *    el id que NOSOTROS le dimos a la tienda al vincularla a la app.
 *  - Token por tienda: GET /v1/auth/authtoken/get?app_id&app_secret&app_shop_id → auth_token con
 *    vencimiento; si vence (errno 10102) se renueva con /auth/authtoken/refresh (enfriamiento de
 *    2 min) y se vuelve a pedir.
 *  - Webhooks (una sola URL por app, para todas sus tiendas): header `didi-header-sign` =
 *    MD5(body crudo + app_secret). Cuerpo {app_id, app_shop_id, type, timestamp, data}. Tipos:
 *    orderNew (data = mismo detalle que /order/order/detail), orderCancel, orderPartialCancel,
 *    orderFinish, deliveryStatus, orderCancelApply, orderRefundApply. Hay que responder JSON
 *    {"errno":0,"errmsg":"ok"} en menos de 6 s o DiDi reintenta.
 *  - Aceptar: POST /v1/order/order/confirm {auth_token, order_id} — en menos de 5 min o DiDi
 *    cancela solo. Rechazar: POST /v1/order/order/cancel {auth_token, order_id, reason_id}.
 *  - Ids de 64 bits (order_id, app_id, shop_id): se parsean y se mandan como texto exacto.
 *  - Precios en centavos (MXN).
 *
 * NO verificado de punta a punta: requiere una app de prueba y tienda de prueba de DiDi.
 */
@Injectable()
export class DidiAdapter implements PlataformaDeliveryAdapter {
  readonly codigo = "didi";
  readonly nombreVisible = "DiDi Food";
  private readonly logger = new Logger(DidiAdapter.name);
  private readonly tokens = new CacheTokens();

  constructor(private readonly config: ConfigService) {}

  validarConfiguracion(credenciales: CredencialesPlataforma): void {
    if (!credenciales.extra.apiKey) throw new Error("Falta el App ID de DiDi (API Key)");
    if (!/^\d+$/.test(credenciales.extra.apiKey.trim())) throw new Error("El App ID de DiDi debe ser numérico (como aparece en Application Management)");
    if (!credenciales.extra.clientSecret) throw new Error("Falta el App Secret de DiDi (Client Secret) — sin esto no se pueden verificar los webhooks");
    if (!credenciales.identificadorTienda) throw new Error("Falta el app_shop_id: el id de tienda con el que se vinculó la tienda a tu app de DiDi");
  }

  campoPrincipalEnmascarado(credenciales: CredencialesPlataforma): string {
    return credenciales.extra.apiKey.slice(-4);
  }

  tieneClientSecret(credenciales: CredencialesPlataforma): boolean {
    return Boolean(credenciales.extra.clientSecret);
  }

  /** Pedir el auth_token de la tienda valida App ID, App Secret y que la tienda esté vinculada. */
  async probarConexion(credenciales: CredencialesPlataforma): Promise<ResultadoPruebaConexionPlataforma> {
    try {
      this.tokens.invalidar(this.claveToken(credenciales));
      await this.token(credenciales);
      return { ok: true, detalle: "DiDi Food aceptó las credenciales y la tienda está vinculada (token obtenido)." };
    } catch (e: any) {
      return { ok: false, detalle: e?.message ?? "No se pudo conectar con DiDi Food" };
    }
  }

  /** DiDi manda los eventos de TODAS las tiendas de la app a la misma URL: este es el
   *  app_shop_id de la tienda del evento, para que el servicio lo enrute a su sucursal. */
  tiendaDelWebhook(peticion: PeticionWebhook): string | null {
    try {
      const body = this.cuerpo(peticion);
      return body?.app_shop_id != null ? String(body.app_shop_id) : null;
    } catch {
      return null;
    }
  }

  /** DiDi espera {"errno":0,"errmsg":"ok"}; cualquier otra respuesta la reintenta. */
  respuestaWebhook(exito: boolean): unknown {
    return exito ? { errno: 0, errmsg: "ok" } : { errno: 1, errmsg: "error interno, reintentar" };
  }

  async procesarWebhook(credenciales: CredencialesPlataforma, peticion: PeticionWebhook): Promise<WebhookProcesadoPlataforma> {
    const firma = peticion.headers["didi-header-sign"];
    if (!firma) throw new Error("Webhook de DiDi sin firma (didi-header-sign) — rechazado");
    const esperada = createHash("md5").update(cuerpoParaFirma(peticion) + credenciales.extra.clientSecret).digest("hex");
    if (!firmasIguales(esperada, firma)) throw new Error("Firma de webhook de DiDi inválida — rechazado");

    const body = this.cuerpo(peticion);
    const tipo = String(body?.type ?? "desconocido");
    const data = typeof body?.data === "string" ? parsearJsonConEnterosLargos(body.data) : body?.data ?? {};
    const ordenId = data?.order_id ?? data?.order_info?.order_id;
    const extra = tipo === "deliveryStatus" ? `:${data?.delivery_status ?? ""}` : "";
    const eventoExternoId = `${tipo}:${ordenId ?? "-"}:${body?.timestamp ?? ""}${extra}`;
    if (ordenId == null) return { eventoExternoId, orden: null };

    const base: OrdenExternaEntrante = {
      ordenExternaId: String(ordenId),
      tipoEvento: tipo,
      estadoExterno: tipo,
      payloadSanitizado: { orderId: String(ordenId), eventType: tipo },
    };

    if (tipo === "orderNew") {
      const mapeado = mapearOrdenDidi(data);
      return { eventoExternoId, orden: { ...base, ...mapeado, payloadSanitizado: { ...base.payloadSanitizado, ...mapeado.payloadSanitizado } } };
    }
    if (tipo === "orderCancel") return { eventoExternoId, orden: { ...base, estadoExterno: "CANCELADO", cancelada: true } };
    if (tipo === "orderFinish") return { eventoExternoId, orden: { ...base, estadoExterno: "ENTREGADO" } };
    if (tipo === "deliveryStatus") {
      return { eventoExternoId, orden: { ...base, estadoExterno: ESTADOS_REPARTO_DIDI[Number(data?.delivery_status)] ?? `Reparto ${data?.delivery_status}` } };
    }
    if (tipo === "orderPartialCancel") return { eventoExternoId, orden: { ...base, estadoExterno: "CANCELACIÓN PARCIAL — revisa en la tablet de DiDi" } };
    if (tipo === "orderCancelApply" || tipo === "orderRefundApply") {
      // Se avisa en la bandeja; la respuesta a la solicitud se hace desde la tablet de DiDi.
      const que = tipo === "orderCancelApply" ? "SOLICITA CANCELACIÓN" : "SOLICITA REEMBOLSO";
      return { eventoExternoId, orden: { ...base, estadoExterno: `CLIENTE ${que} — atiéndelo en la tablet de DiDi` } };
    }
    return { eventoExternoId, orden: null };
  }

  async aceptarOrden(credenciales: CredencialesPlataforma, ordenExternaId: string): Promise<ResultadoAccionPlataforma> {
    return this.accion(credenciales, "/order/order/confirm", ordenExternaId, {}, "aceptar la orden");
  }

  async rechazarOrden(credenciales: CredencialesPlataforma, ordenExternaId: string, motivo: string): Promise<ResultadoAccionPlataforma> {
    return this.accion(credenciales, "/order/order/cancel", ordenExternaId, { reason_id: motivoCancelacionDidi(motivo), reason: motivo.slice(0, 200) }, "rechazar la orden");
  }

  // --- privados ---------------------------------------------------------------------------

  private urlApi() {
    return (this.config.get<string>("DIDI_API_BASE_URL") || URL_API_DEFAULT).replace(/\/$/, "");
  }

  private claveToken(c: CredencialesPlataforma) {
    return `${c.extra.apiKey}:${c.identificadorTienda}`;
  }

  private cuerpo(peticion: PeticionWebhook): any {
    const raw = cuerpoParaFirma(peticion).trim();
    if (raw.startsWith("{")) return parsearJsonConEnterosLargos(raw);
    // Formato form (DiDi permite elegirlo por app): data viene como JSON en texto.
    const form = Object.fromEntries(new URLSearchParams(raw));
    return { ...form, data: form.data ? parsearJsonConEnterosLargos(form.data) : undefined };
  }

  private async llamarApi(ruta: string, init: RequestInit = {}): Promise<{ errno: number; errmsg?: string; data?: any }> {
    let res: Response;
    try {
      res = await fetchConReintentos(`${this.urlApi()}${ruta}`, init, { reintentos: 1 });
    } catch (e) {
      throw new Error(mensajeErrorRed("DiDi Food", e));
    }
    if (!res.ok) throw new Error(mensajeErrorHttp("DiDi Food", res.status));
    return parsearJsonConEnterosLargos(await res.text());
  }

  private async token(credenciales: CredencialesPlataforma): Promise<string> {
    const consulta = new URLSearchParams({
      app_id: credenciales.extra.apiKey.trim(),
      app_secret: credenciales.extra.clientSecret,
      app_shop_id: credenciales.identificadorTienda ?? "",
    }).toString();
    return this.tokens.obtener(this.claveToken(credenciales), async () => {
      let r = await this.llamarApi(`/auth/authtoken/get?${consulta}`);
      if (r.errno === 10102) {
        // Token vencido: se renueva (enfriamiento de 2 min en DiDi) y se vuelve a pedir.
        await this.llamarApi(`/auth/authtoken/refresh?${consulta}`);
        r = await this.llamarApi(`/auth/authtoken/get?${consulta}`);
      }
      if (r.errno !== 0 || !r.data?.auth_token) {
        throw new Error(`DiDi Food rechazó el inicio de sesión: ${ERRORES_DIDI[r.errno] ?? r.errmsg ?? `error ${r.errno}`}.`);
      }
      const vence = Number(r.data.token_expiration_time) || 0;
      const segundos = vence ? vence - Math.floor(Date.now() / 1000) : 3600;
      return { token: String(r.data.auth_token), expiraEnSegundos: Math.max(segundos, 120) };
    });
  }

  private async accion(credenciales: CredencialesPlataforma, ruta: string, ordenId: string, extra: Record<string, unknown>, descripcion: string): Promise<ResultadoAccionPlataforma> {
    try {
      const token = await this.token(credenciales);
      if (!/^\d+$/.test(ordenId)) return { ok: false, detalle: `El id de orden de DiDi no es válido (${ordenId}).` };
      // order_id va como número EXACTO de 64 bits: se escribe a mano en el JSON (JSON.stringify
      // de un Number lo redondearía).
      const cuerpo = `{"auth_token":${JSON.stringify(token)},"order_id":${ordenId}${Object.entries(extra)
        .map(([k, v]) => `,${JSON.stringify(k)}:${JSON.stringify(v)}`)
        .join("")}}`;
      const r = await this.llamarApi(ruta, { method: "POST", headers: { "Content-Type": "application/json" }, body: cuerpo });
      if (r.errno === 10102) this.tokens.invalidar(this.claveToken(credenciales));
      if (r.errno !== 0 || r.data === false) {
        return { ok: false, detalle: `DiDi Food no pudo ${descripcion}: ${ERRORES_DIDI[r.errno] ?? r.errmsg ?? `error ${r.errno}`}.` };
      }
      return { ok: true, detalle: "DiDi Food confirmó la operación." };
    } catch (e: any) {
      return { ok: false, detalle: e?.message ?? mensajeErrorRed("DiDi Food", e) };
    }
  }
}

const ESTADOS_REPARTO_DIDI: Record<number, string> = {
  120: "Repartidor asignado",
  130: "Repartidor en la tienda",
  140: "Repartidor recogió el pedido",
  150: "Repartidor con el cliente",
  160: "Entregado",
  170: "Reparto cancelado",
  180: "Repartidor reasignado",
  190: "Reparto abortado",
};

/** El motivo libre del cajero → reason_id de DiDi. */
export function motivoCancelacionDidi(motivo: string): number {
  const m = motivo.toLowerCase();
  if (/agotad|sin (producto|insumo|existencia)|no hay/.test(m)) return MOTIVOS_CANCELACION_DIDI.AGOTADO;
  if (/cerrad|fuera de horario/.test(m)) return MOTIVOS_CANCELACION_DIDI.CERRADO;
  if (/ocupad|satura|mucho trabajo|demora/.test(m)) return MOTIVOS_CANCELACION_DIDI.OCUPADO;
  if (/luz|agua|apag[oó]n|electric/.test(m)) return MOTIVOS_CANCELACION_DIDI.SIN_SERVICIOS;
  if (/cliente/.test(m)) return MOTIVOS_CANCELACION_DIDI.CLIENTE;
  return MOTIVOS_CANCELACION_DIDI.OTRO;
}

/** `data` de orderNew (= detalle de /order/order/detail) → forma normalizada. Precios en
 *  centavos. NO guarda teléfono, dirección ni coordenadas del cliente. */
export function mapearOrdenDidi(data: any): Partial<OrdenExternaEntrante> & { payloadSanitizado: Record<string, unknown> } {
  const info = data?.order_info ?? data ?? {};
  const centavos = (v: any) => (numeroONull(v) === null ? null : Number(v) / 100);
  const items: ItemOrdenExterna[] = (Array.isArray(info.order_items) ? info.order_items : []).map((it: any) => ({
    nombreExterno: String(it.name ?? "Producto sin nombre"),
    cantidad: Number(it.amount ?? 1),
    precioUnitario: centavos(it.sku_price) ?? undefined,
    notas: (Array.isArray(it.remark) ? it.remark.join(" ") : it.remark) || undefined,
    modificadores: aplanarSubitems(it.sub_item_list),
  }));
  const precio = info.price ?? {};
  const otros = precio.others_fees ?? {};
  const totalCliente = numeroONull(precio.real_pay_price) ?? (numeroONull(precio.order_price) !== null ? Number(precio.order_price) - (Number(precio.items_discount) || 0) : null);
  const nombre = info.receive_address?.first_name;
  const entrega = {
    tipo: Number(info.fulfillment_mode) === 1 ? "PICKUP" : Number(info.delivery_type) === 2 ? "Reparto de la tienda" : "Reparto de DiDi",
    repartidor: null,
    horaEstimada: Number(info.expected_cook_eta) > 0 ? new Date(Number(info.expected_cook_eta) * 1000).toISOString() : null,
    codigoEntrega: info.order_index != null ? String(info.order_index) : null,
  };
  const montos = {
    subtotal: centavos(precio.order_price),
    envio: centavos(precio.delivery_price),
    propina: centavos(otros.total_tip_money),
    descuento: centavos(precio.items_discount),
  };
  return {
    folioCorto: info.order_index != null ? String(info.order_index) : null,
    estadoExterno: info.status != null ? `Estado DiDi ${info.status}` : "orderNew",
    clienteNombre: nombre && !/privacy/i.test(nombre) ? String(nombre) : null,
    total: totalCliente === null ? null : totalCliente / 100,
    notas: info.remark || null,
    items,
    entrega,
    montos,
    payloadSanitizado: { items, folioCorto: info.order_index != null ? String(info.order_index) : null, entrega, montos, notas: info.remark || null },
  };
}

function aplanarSubitems(lista: any, prefijo = ""): string[] {
  if (!Array.isArray(lista)) return [];
  return lista.flatMap((s: any) => {
    const nombre = `${prefijo}${Number(s.amount ?? 1) > 1 ? `${s.amount}× ` : ""}${s.name ?? ""}`.trim();
    return [nombre, ...aplanarSubitems(s.sub_item_list, `${nombre} › `)].filter(Boolean);
  });
}
