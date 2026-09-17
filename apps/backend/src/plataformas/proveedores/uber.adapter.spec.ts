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

describe("UberAdapter — verificación de firma de webhook", () => {
  const adapter = new UberAdapter({ get: () => undefined } as any);
  const creds = credenciales();
  const body = { event_id: "evt-uber-1", order_id: "ord-uber-1", event_type: "order.created", status: "recibido" };
  const firmaValida = createHmac("sha256", creds.extra.clientSecret).update(JSON.stringify(body)).digest("hex");

  it("acepta una firma válida", async () => {
    const resultado = await adapter.procesarWebhook(creds, {
      headers: { "x-uber-signature": firmaValida },
      query: {},
      body,
    });
    expect(resultado.eventoExternoId).toBe("evt-uber-1");
    expect(resultado.orden?.ordenExternaId).toBe("ord-uber-1");
  });

  it("rechaza una firma alterada", async () => {
    await expect(
      adapter.procesarWebhook(creds, { headers: { "x-uber-signature": "0".repeat(firmaValida.length) }, query: {}, body }),
    ).rejects.toThrow(/inválida/);
  });

  it("rechaza una firma con el secreto equivocado", async () => {
    const firmaSecretoEquivocado = createHmac("sha256", "otro-secreto").update(JSON.stringify(body)).digest("hex");
    await expect(
      adapter.procesarWebhook(creds, { headers: { "x-uber-signature": firmaSecretoEquivocado }, query: {}, body }),
    ).rejects.toThrow(/inválida/);
  });

  it("rechaza si falta el header de firma", async () => {
    await expect(adapter.procesarWebhook(creds, { headers: {}, query: {}, body })).rejects.toThrow(/sin firma/);
  });
});

describe("UberAdapter — probarConexion", () => {
  afterEach(() => jest.restoreAllMocks());

  it("devuelve ok:false si no hay UBER_API_BASE_URL configurado", async () => {
    const adapter = new UberAdapter({ get: () => undefined } as any);
    const resultado = await adapter.probarConexion(credenciales());
    expect(resultado.ok).toBe(false);
    expect(resultado.detalle).toMatch(/UBER_API_BASE_URL/);
  });

  it("devuelve ok:true si el host responde 2xx", async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "{}" });
    const adapter = new UberAdapter({ get: () => "https://api-sandbox.uber.test" } as any);
    const resultado = await adapter.probarConexion(credenciales());
    expect(resultado.ok).toBe(true);
  });

  it("devuelve ok:false ante timeout/error de red", async () => {
    (global as any).fetch = jest.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }));
    const adapter = new UberAdapter({ get: () => "https://api-sandbox.uber.test" } as any);
    const resultado = await adapter.probarConexion(credenciales());
    expect(resultado.ok).toBe(false);
  });
});
