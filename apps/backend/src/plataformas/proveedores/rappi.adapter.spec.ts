import { createHmac } from "crypto";
import { RappiAdapter } from "./rappi.adapter";
import { CredencialesPlataforma } from "./plataforma-delivery.interface";

function credenciales(overrides: Partial<CredencialesPlataforma["extra"]> = {}): CredencialesPlataforma {
  return {
    ambiente: "SANDBOX",
    identificadorTienda: "store-rappi-1",
    extra: { clientId: "client-id-9012", clientSecret: "secreto-rappi", webhookSecret: "secreto-webhook", ...overrides },
  };
}

describe("RappiAdapter — validarConfiguracion", () => {
  const adapter = new RappiAdapter({ get: () => undefined } as any);

  it("lanza si falta clientId", () => {
    expect(() => adapter.validarConfiguracion(credenciales({ clientId: "" }))).toThrow(/Client ID/);
  });

  it("lanza si falta clientSecret", () => {
    expect(() => adapter.validarConfiguracion(credenciales({ clientSecret: "" }))).toThrow(/Client Secret/);
  });

  it("lanza si falta identificadorTienda", () => {
    const creds = { ...credenciales(), identificadorTienda: null };
    expect(() => adapter.validarConfiguracion(creds)).toThrow(/tienda/);
  });

  it("no lanza con configuración completa", () => {
    expect(() => adapter.validarConfiguracion(credenciales())).not.toThrow();
  });
});

describe("RappiAdapter — campoPrincipalEnmascarado / tieneClientSecret", () => {
  const adapter = new RappiAdapter({ get: () => undefined } as any);

  it("devuelve los últimos 4 caracteres del clientId", () => {
    expect(adapter.campoPrincipalEnmascarado(credenciales({ clientId: "abcdef9012" }))).toBe("9012");
  });

  it("reporta si hay clientSecret configurado", () => {
    expect(adapter.tieneClientSecret(credenciales())).toBe(true);
    expect(adapter.tieneClientSecret(credenciales({ clientSecret: "" }))).toBe(false);
  });
});

describe("RappiAdapter — webhook (Rappi-Signature t=…,sign=…)", () => {
  const adapter = new RappiAdapter({ get: () => undefined } as any);
  const creds = credenciales();
  const raw = '{"event": "NEW_ORDER", "order_detail": {"order_id": "R-777", "items": [{"name": "Latte", "quantity": 2, "price": 70, "subitems": [{"name": "Avena"}]}], "totals": {"total_order": 140}}, "customer": {"first_name": "Eva", "phone": "5550000000"}}';
  const body = JSON.parse(raw);
  const t = "1700000000";
  const firma = (secreto: string, cuerpo = raw) => `t=${t},sign=${createHmac("sha256", secreto).update(`${t}.${cuerpo}`).digest("hex")}`;

  it("acepta una firma válida y normaliza la orden", async () => {
    const r = await adapter.procesarWebhook(creds, { headers: { "rappi-signature": firma("secreto-webhook") }, query: {}, body, rawBody: raw });
    expect(r.orden?.ordenExternaId).toBe("R-777");
    expect(r.orden?.total).toBe(140);
    expect(r.orden?.items?.[0]).toMatchObject({ nombreExterno: "Latte", cantidad: 2, modificadores: ["Avena"] });
    expect(r.eventoExternoId).toBe(`NEW_ORDER:R-777:${t}`);
    expect(JSON.stringify(r.orden?.payloadSanitizado)).not.toContain("5550000000");
  });

  it("rechaza una firma hecha con otro secreto", async () => {
    await expect(adapter.procesarWebhook(creds, { headers: { "rappi-signature": firma("otro") }, query: {}, body, rawBody: raw })).rejects.toThrow(/inválida/);
  });

  it("rechaza si el body crudo fue alterado", async () => {
    await expect(
      adapter.procesarWebhook(creds, { headers: { "rappi-signature": firma("secreto-webhook") }, query: {}, body, rawBody: raw.replace("140", "1") }),
    ).rejects.toThrow(/inválida/);
  });

  it("rechaza sin header, con header mal formado o sin secreto de webhook configurado", async () => {
    await expect(adapter.procesarWebhook(creds, { headers: {}, query: {}, body, rawBody: raw })).rejects.toThrow(/sin firma/);
    await expect(adapter.procesarWebhook(creds, { headers: { "rappi-signature": "abc" }, query: {}, body, rawBody: raw })).rejects.toThrow(/mal formada/);
    await expect(
      adapter.procesarWebhook(credenciales({ webhookSecret: "" }), { headers: { "rappi-signature": firma("secreto-webhook") }, query: {}, body, rawBody: raw }),
    ).rejects.toThrow(/secreto del webhook/);
  });

  it("un evento de cancelación marca la orden como cancelada", async () => {
    const rawC = '{"event":"ORDER_EVENT_CANCEL","order_id":"R-777"}';
    const r = await adapter.procesarWebhook(creds, { headers: { "rappi-signature": firma("secreto-webhook", rawC) }, query: {}, body: JSON.parse(rawC), rawBody: rawC });
    expect(r.orden?.cancelada).toBe(true);
  });
});

describe("RappiAdapter — probarConexion y aceptar", () => {
  afterEach(() => jest.restoreAllMocks());
  const conAudience = { get: (k: string) => (k === "RAPPI_AUTH_AUDIENCE" ? "aud-test" : undefined) } as any;

  it("sin RAPPI_AUTH_AUDIENCE explica qué falta configurar", async () => {
    const r = await new RappiAdapter({ get: () => undefined } as any).probarConexion(credenciales());
    expect(r.ok).toBe(false);
    expect(r.detalle).toMatch(/RAPPI_AUTH_AUDIENCE/);
  });

  it("pide el token a Auth0 de desarrollo en ambiente de Pruebas", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ access_token: "tok", expires_in: 604800 }) });
    (global as any).fetch = fetchMock;
    const r = await new RappiAdapter(conAudience).probarConexion(credenciales());
    expect(r.ok).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe("https://rests-integrations-dev.auth0.com/oauth/token");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ grant_type: "client_credentials", audience: "aud-test" });
  });

  it("aceptarOrden hace PUT …/take con x-authorization", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: "tok", expires_in: 604800 }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    (global as any).fetch = fetchMock;
    const r = await new RappiAdapter(conAudience).aceptarOrden(credenciales(), "R-777");
    expect(r.ok).toBe(true);
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.dev.rappi.com/restaurants/orders/v1/stores/store-rappi-1/orders/R-777/take");
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "PUT", headers: { "x-authorization": "bearer tok" } });
  });

  it("no implementa rechazar por API (se registra como manual)", () => {
    expect((new RappiAdapter(conAudience) as any).rechazarOrden).toBeUndefined();
  });
});
