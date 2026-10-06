import { createHmac } from "crypto";
import { UberAdapter } from "./uber.adapter";
import { CredencialesPlataforma } from "./plataforma-delivery.interface";

function credenciales(overrides: Partial<CredencialesPlataforma["extra"]> = {}): CredencialesPlataforma {
  return {
    ambiente: "SANDBOX",
    identificadorTienda: "store-1",
    extra: { clientId: "client-id-5678", clientSecret: "secreto-uber", ...overrides },
  };
}

describe("UberAdapter — validarConfiguracion", () => {
  const adapter = new UberAdapter({ get: () => undefined } as any);

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

describe("UberAdapter — campoPrincipalEnmascarado / tieneClientSecret", () => {
  const adapter = new UberAdapter({ get: () => undefined } as any);

  it("devuelve los últimos 4 caracteres del clientId", () => {
    expect(adapter.campoPrincipalEnmascarado(credenciales({ clientId: "abcdef5678" }))).toBe("5678");
  });

  it("reporta si hay clientSecret configurado", () => {
    expect(adapter.tieneClientSecret(credenciales())).toBe(true);
    expect(adapter.tieneClientSecret(credenciales({ clientSecret: "" }))).toBe(false);
  });
});

describe("UberAdapter — webhook (X-Uber-Signature sobre el body crudo)", () => {
  afterEach(() => jest.restoreAllMocks());
  const adapter = new UberAdapter({ get: () => undefined } as any);
  const creds = credenciales();
  // Body crudo con espacios: re-serializar el JSON daría otra firma.
  const raw = '{"event_id": "evt-uber-1", "event_type": "orders.cancel", "meta": {"resource_id": "ord-uber-1", "status": "CANCELED"}}';
  const body = JSON.parse(raw);
  const firmaValida = createHmac("sha256", creds.extra.clientSecret).update(raw).digest("hex");

  it("acepta una firma válida calculada sobre el body crudo", async () => {
    const resultado = await adapter.procesarWebhook(creds, { headers: { "x-uber-signature": firmaValida }, query: {}, body, rawBody: raw });
    expect(resultado.eventoExternoId).toBe("evt-uber-1");
    expect(resultado.orden?.ordenExternaId).toBe("ord-uber-1");
    expect(resultado.orden?.cancelada).toBe(true);
  });

  it("acepta la firma aunque venga en mayúsculas", async () => {
    await expect(adapter.procesarWebhook(creds, { headers: { "x-uber-signature": firmaValida.toUpperCase() }, query: {}, body, rawBody: raw })).resolves.toBeTruthy();
  });

  it("rechaza si la firma se calculó sobre el JSON re-serializado y no sobre el crudo", async () => {
    const firmaReserializada = createHmac("sha256", creds.extra.clientSecret).update(JSON.stringify(body)).digest("hex");
    await expect(adapter.procesarWebhook(creds, { headers: { "x-uber-signature": firmaReserializada }, query: {}, body, rawBody: raw })).rejects.toThrow(/inválida/);
  });

  it("rechaza una firma con el secreto equivocado", async () => {
    const otra = createHmac("sha256", "otro-secreto").update(raw).digest("hex");
    await expect(adapter.procesarWebhook(creds, { headers: { "x-uber-signature": otra }, query: {}, body, rawBody: raw })).rejects.toThrow(/inválida/);
  });

  it("rechaza si falta el header de firma", async () => {
    await expect(adapter.procesarWebhook(creds, { headers: {}, query: {}, body, rawBody: raw })).rejects.toThrow(/sin firma/);
  });

  it("orders.notification pide el detalle de la orden y lo normaliza (montos en centavos)", async () => {
    const rawNueva = '{"event_id":"evt-2","event_type":"orders.notification","meta":{"resource_id":"ord-2","status":"pos"}}';
    const firma = createHmac("sha256", creds.extra.clientSecret).update(rawNueva).digest("hex");
    (global as any).fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: "tok", expires_in: 2592000 }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          display_id: "A1B2C",
          current_state: "CREATED",
          type: "DELIVERY_BY_UBER",
          eater: { first_name: "Luis", phone: "+52 55 0000 0000" },
          cart: {
            special_instructions: "Sin popote",
            items: [{ title: "Latte", quantity: 2, price: { unit_price: { amount: 7000 } }, selected_modifier_groups: [{ selected_items: [{ title: "Avena", quantity: 1 }] }] }],
          },
          payment: { charges: { total: { amount: 14000 }, sub_total: { amount: 14000 } } },
        }),
      });
    const r = await adapter.procesarWebhook(creds, { headers: { "x-uber-signature": firma }, query: {}, body: JSON.parse(rawNueva), rawBody: rawNueva });
    expect(r.orden?.folioCorto).toBe("A1B2C");
    expect(r.orden?.total).toBe(140);
    expect(r.orden?.items?.[0]).toMatchObject({ nombreExterno: "Latte", cantidad: 2, precioUnitario: 70, modificadores: ["Avena"] });
    expect(JSON.stringify(r.orden?.payloadSanitizado)).not.toContain("0000");
  });
});

describe("UberAdapter — probarConexion y aceptar", () => {
  afterEach(() => jest.restoreAllMocks());

  it("pide un token OAuth (client_credentials) y responde ok si Uber lo da", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ access_token: "tok", expires_in: 3600 }) });
    (global as any).fetch = fetchMock;
    const resultado = await new UberAdapter({ get: () => undefined } as any).probarConexion(credenciales());
    expect(resultado.ok).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe("https://auth.uber.com/oauth/v2/token");
    expect(String(fetchMock.mock.calls[0][1].body)).toContain("grant_type=client_credentials");
  });

  it("401 en el token da un mensaje accionable sin exponer el secreto", async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    const resultado = await new UberAdapter({ get: () => undefined } as any).probarConexion(credenciales());
    expect(resultado.ok).toBe(false);
    expect(resultado.detalle).toMatch(/Client ID \/ Client Secret/);
    expect(resultado.detalle).not.toContain("secreto-uber");
  });

  it("ante error de red no repite el mensaje interno", async () => {
    (global as any).fetch = jest.fn().mockRejectedValue(Object.assign(new Error("getaddrinfo ENOTFOUND interno.local"), { name: "TypeError" }));
    const resultado = await new UberAdapter({ get: () => undefined } as any).probarConexion(credenciales());
    expect(resultado.ok).toBe(false);
    expect(resultado.detalle).not.toContain("interno.local");
  });

  it("aceptarOrden llama a accept_pos_order con el token", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: "tok", expires_in: 3600 }) })
      .mockResolvedValueOnce({ ok: true, status: 204, json: async () => ({}) });
    (global as any).fetch = fetchMock;
    const r = await new UberAdapter({ get: () => undefined } as any).aceptarOrden(credenciales(), "ord-9");
    expect(r.ok).toBe(true);
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.uber.com/v1/eats/orders/ord-9/accept_pos_order");
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer tok");
  });

  it("aceptarOrden devuelve ok:false con el motivo si Uber responde 409", async () => {
    (global as any).fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: "tok", expires_in: 3600 }) })
      .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({}) });
    const r = await new UberAdapter({ get: () => undefined } as any).aceptarOrden(credenciales(), "ord-9");
    expect(r.ok).toBe(false);
    expect(r.detalle).toMatch(/409/);
  });
});
