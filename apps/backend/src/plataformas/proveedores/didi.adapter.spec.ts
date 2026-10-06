// La firma es la única defensa contra un webhook falsificado: si falla, cualquiera podría
// meter un "pedido" falso a /plataformas/webhooks/didi/:webhookSlug. Formato oficial (portal de
// DiDi Food, oct-2026): didi-header-sign = MD5(body crudo + app_secret).

import { createHash } from "crypto";
import { DidiAdapter, mapearOrdenDidi, motivoCancelacionDidi } from "./didi.adapter";
import { CredencialesPlataforma } from "./plataforma-delivery.interface";
import { parsearJsonConEnterosLargos } from "./http-plataforma";

function credenciales(overrides: Partial<CredencialesPlataforma["extra"]> = {}): CredencialesPlataforma {
  return {
    ambiente: "SANDBOX",
    identificadorTienda: "BJ-01",
    extra: { apiKey: "1152921557674426642", clientSecret: "secreto-didi", ...overrides },
  };
}
const firmar = (raw: string, secreto = "secreto-didi") => createHash("md5").update(raw + secreto).digest("hex");
const respuesta = (cuerpo: string, status = 200) => ({ ok: status < 300, status, text: async () => cuerpo, json: async () => JSON.parse(cuerpo) });

describe("parsearJsonConEnterosLargos", () => {
  it("conserva exactos los ids de 64 bits que JSON.parse redondearía", () => {
    const raw = '{"order_id": 5764607801871631353, "precio": 2500, "lista": [1152921547153933576, 3], "texto": "id 5764607801871631353"}';
    expect(JSON.parse(raw).order_id).not.toBe(5764607801871631353n.toString());
    const r = parsearJsonConEnterosLargos(raw);
    expect(r.order_id).toBe("5764607801871631353");
    expect(r.lista[0]).toBe("1152921547153933576");
    expect(r.precio).toBe(2500);
    expect(r.texto).toBe("id 5764607801871631353");
  });
});

describe("DidiAdapter — validarConfiguracion", () => {
  const adapter = new DidiAdapter({ get: () => undefined } as any);
  it("exige App ID numérico, App Secret y app_shop_id", () => {
    expect(() => adapter.validarConfiguracion(credenciales({ apiKey: "" }))).toThrow(/App ID/);
    expect(() => adapter.validarConfiguracion(credenciales({ apiKey: "abc" }))).toThrow(/numérico/);
    expect(() => adapter.validarConfiguracion(credenciales({ clientSecret: "" }))).toThrow(/App Secret/);
    expect(() => adapter.validarConfiguracion({ ...credenciales(), identificadorTienda: null })).toThrow(/app_shop_id/);
    expect(() => adapter.validarConfiguracion(credenciales())).not.toThrow();
  });
  it("enmascara el App ID", () => {
    expect(adapter.campoPrincipalEnmascarado(credenciales())).toBe("6642");
    expect(adapter.tieneClientSecret(credenciales({ clientSecret: "" }))).toBe(false);
  });
});

describe("DidiAdapter — webhook", () => {
  const adapter = new DidiAdapter({ get: () => undefined } as any);
  const creds = credenciales();
  const rawNueva =
    '{"app_id": 5764607584567296012, "app_shop_id": "BJ-01", "timestamp": 1615432308, "type": "orderNew", "data": {"order_id": 1152921547153933576, "order_info": {"order_id": 1152921547153933576, "status": 100, "order_index": 2, "remark": "Sin popote", "delivery_type": 1, "fulfillment_mode": 0, "expected_cook_eta": 1615432434, "price": {"order_price": 25000, "items_discount": 4900, "delivery_price": 0, "others_fees": {"total_tip_money": 1000}}, "receive_address": {"first_name": "Ana", "phone": "5512345678", "poi_address": "Calle Secreta 123"}, "order_items": [{"name": "Latte", "amount": 2, "sku_price": 7000, "total_price": 14000, "remark": "", "sub_item_list": [{"name": "Leche de avena", "amount": 1, "sub_item_list": []}]}, {"name": "Brownie de Manzana Verde", "amount": 1, "sku_price": 4900, "sub_item_list": []}]}}}';

  it("acepta la firma oficial (MD5 de body crudo + app_secret) y normaliza orderNew sin perder el id", async () => {
    const r = await adapter.procesarWebhook(creds, { headers: { "didi-header-sign": firmar(rawNueva) }, query: {}, body: JSON.parse(rawNueva), rawBody: rawNueva });
    expect(r.orden?.ordenExternaId).toBe("1152921547153933576");
    expect(r.eventoExternoId).toBe("orderNew:1152921547153933576:1615432308");
    expect(r.orden?.folioCorto).toBe("2");
    expect(r.orden?.total).toBe(201);
    expect(r.orden?.notas).toBe("Sin popote");
    expect(r.orden?.items?.[0]).toMatchObject({ nombreExterno: "Latte", cantidad: 2, precioUnitario: 70, modificadores: ["Leche de avena"] });
    expect(r.orden?.montos).toMatchObject({ subtotal: 250, descuento: 49, propina: 10 });
    const guardado = JSON.stringify(r.orden?.payloadSanitizado);
    expect(guardado).not.toContain("5512345678");
    expect(guardado).not.toContain("Calle Secreta");
  });

  it("rechaza firma alterada, con otro secreto, o ausente", async () => {
    const body = JSON.parse(rawNueva);
    await expect(adapter.procesarWebhook(creds, { headers: { "didi-header-sign": "0".repeat(32) }, query: {}, body, rawBody: rawNueva })).rejects.toThrow(/inválida/);
    await expect(adapter.procesarWebhook(creds, { headers: { "didi-header-sign": firmar(rawNueva, "otro") }, query: {}, body, rawBody: rawNueva })).rejects.toThrow(/inválida/);
    await expect(adapter.procesarWebhook(creds, { headers: {}, query: {}, body, rawBody: rawNueva })).rejects.toThrow(/sin firma/);
  });

  it("orderCancel cancela; deliveryStatus y solicitudes solo actualizan el estado externo", async () => {
    const proc = (raw: string) => adapter.procesarWebhook(creds, { headers: { "didi-header-sign": firmar(raw) }, query: {}, body: {}, rawBody: raw });
    const c = await proc('{"app_id":1,"app_shop_id":"BJ-01","type":"orderCancel","timestamp":1592970557,"data":{"order_id":5764607801871630353}}');
    expect(c.orden).toMatchObject({ ordenExternaId: "5764607801871630353", cancelada: true });
    const d = await proc('{"app_id":1,"app_shop_id":"BJ-01","type":"deliveryStatus","timestamp":1612455327,"data":{"order_id":5764608647577512345,"delivery_status":140,"rider_phone":"155"}}');
    expect(d.orden?.estadoExterno).toBe("Repartidor recogió el pedido");
    expect(d.eventoExternoId).toBe("deliveryStatus:5764608647577512345:1612455327:140");
    const s = await proc('{"app_id":1,"app_shop_id":"BJ-01","type":"orderCancelApply","timestamp":1,"data":{"order_id":1152921654762996500}}');
    expect(s.orden?.cancelada).toBeFalsy();
    expect(s.orden?.estadoExterno).toMatch(/SOLICITA CANCELACIÓN/);
  });

  it("identifica la tienda del evento y responde con el formato que DiDi espera", () => {
    expect(adapter.tiendaDelWebhook({ headers: {}, query: {}, body: {}, rawBody: rawNueva })).toBe("BJ-01");
    expect(adapter.respuestaWebhook(true)).toEqual({ errno: 0, errmsg: "ok" });
    expect((adapter.respuestaWebhook(false) as any).errno).toBe(1);
  });
});

describe("DidiAdapter — API (token, confirmar, cancelar)", () => {
  afterEach(() => jest.restoreAllMocks());
  const TOKEN_OK = '{"errno":0,"errmsg":"ok","data":{"app_id":1152921557674426642,"app_shop_id":"BJ-01","auth_token":"tok==","token_expiration_time":4102444800}}';

  it("probarConexion pide el auth_token de la tienda con app_id/app_secret/app_shop_id", async () => {
    const fetchMock = jest.fn().mockResolvedValue(respuesta(TOKEN_OK));
    (global as any).fetch = fetchMock;
    const r = await new DidiAdapter({ get: () => undefined } as any).probarConexion(credenciales());
    expect(r.ok).toBe(true);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url.startsWith("https://openapi.didi-food.com/v1/auth/authtoken/get?")).toBe(true);
    expect(url).toContain("app_id=1152921557674426642");
    expect(url).toContain("app_shop_id=BJ-01");
  });

  it("traduce los errno de DiDi a mensajes accionables (sin exponer el secreto)", async () => {
    (global as any).fetch = jest.fn().mockResolvedValue(respuesta('{"errno":14106,"errmsg":"app_secret is wrong"}'));
    const r = await new DidiAdapter({ get: () => undefined } as any).probarConexion(credenciales());
    expect(r.ok).toBe(false);
    expect(r.detalle).toMatch(/App Secret es incorrecto/);
    expect(r.detalle).not.toContain("secreto-didi");
  });

  it("si el token venció (10102) lo renueva y lo vuelve a pedir", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(respuesta('{"errno":10102,"errmsg":"expired"}'))
      .mockResolvedValueOnce(respuesta('{"errno":0,"data":true}'))
      .mockResolvedValueOnce(respuesta(TOKEN_OK));
    (global as any).fetch = fetchMock;
    const r = await new DidiAdapter({ get: () => undefined } as any).probarConexion(credenciales());
    expect(r.ok).toBe(true);
    expect(String(fetchMock.mock.calls[1][0])).toContain("/auth/authtoken/refresh?");
  });

  it("aceptarOrden confirma con el order_id EXACTO de 64 bits", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(respuesta(TOKEN_OK)).mockResolvedValueOnce(respuesta('{"errno":0,"errmsg":"ok","data":true}'));
    (global as any).fetch = fetchMock;
    const r = await new DidiAdapter({ get: () => undefined } as any).aceptarOrden(credenciales(), "1152921547153933576");
    expect(r.ok).toBe(true);
    expect(fetchMock.mock.calls[1][0]).toBe("https://openapi.didi-food.com/v1/order/order/confirm");
    expect(fetchMock.mock.calls[1][1].body).toBe('{"auth_token":"tok==","order_id":1152921547153933576}');
  });

  it("aceptarOrden falla con el motivo si DiDi responde errno != 0", async () => {
    (global as any).fetch = jest.fn().mockResolvedValueOnce(respuesta(TOKEN_OK)).mockResolvedValueOnce(respuesta('{"errno":10002,"errmsg":"param"}'));
    const r = await new DidiAdapter({ get: () => undefined } as any).aceptarOrden(credenciales(), "1152921547153933576");
    expect(r.ok).toBe(false);
    expect(r.detalle).toMatch(/parámetros inválidos/);
  });

  it("rechazarOrden cancela con reason_id según el motivo", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(respuesta(TOKEN_OK)).mockResolvedValueOnce(respuesta('{"errno":0,"data":true}'));
    (global as any).fetch = fetchMock;
    const r = await new DidiAdapter({ get: () => undefined } as any).rechazarOrden(credenciales(), "5764607801871630353", "Producto agotado");
    expect(r.ok).toBe(true);
    expect(fetchMock.mock.calls[1][0]).toBe("https://openapi.didi-food.com/v1/order/order/cancel");
    expect(fetchMock.mock.calls[1][1].body).toBe('{"auth_token":"tok==","order_id":5764607801871630353,"reason_id":1010,"reason":"Producto agotado"}');
  });

  it("motivos → reason_id", () => {
    expect(motivoCancelacionDidi("Estamos cerrados")).toBe(1020);
    expect(motivoCancelacionDidi("muy ocupados")).toBe(1030);
    expect(motivoCancelacionDidi("se fue la luz")).toBe(1040);
    expect(motivoCancelacionDidi("lo pidió el cliente")).toBe(1050);
    expect(motivoCancelacionDidi("x")).toBe(1080);
  });

  it("mapearOrdenDidi tolera datos con privacidad activada", () => {
    const m = mapearOrdenDidi({ order_info: { order_index: 7, receive_address: { first_name: "privacy protection" }, order_items: [] } });
    expect(m.clienteNombre).toBeNull();
    expect(m.folioCorto).toBe("7");
  });
});
