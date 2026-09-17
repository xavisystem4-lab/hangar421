import { createHmac } from "crypto";
import { RappiAdapter } from "./rappi.adapter";
import { CredencialesPlataforma } from "./plataforma-delivery.interface";

function credenciales(overrides: Partial<CredencialesPlataforma["extra"]> = {}): CredencialesPlataforma {
  return {
    ambiente: "SANDBOX",
    identificadorTienda: "store-rappi-1",
    extra: { clientId: "client-id-9012", clientSecret: "secreto-rappi", ...overrides },
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

describe("RappiAdapter — verificación de firma de webhook", () => {
  const adapter = new RappiAdapter({ get: () => undefined } as any);
  const creds = credenciales();
  const body = { event_id: "evt-rappi-1", order_id: "ord-rappi-1", event_type: "order.created", status: "recibido" };
  const firmaValida = createHmac("sha256", creds.extra.clientSecret).update(JSON.stringify(body)).digest("hex");

  it("acepta una firma válida", async () => {
    const resultado = await adapter.procesarWebhook(creds, {
      headers: { "x-rappi-signature": firmaValida },
      query: {},
      body,
    });
    expect(resultado.eventoExternoId).toBe("evt-rappi-1");
    expect(resultado.orden?.ordenExternaId).toBe("ord-rappi-1");
  });

  it("rechaza una firma alterada", async () => {
    await expect(
      adapter.procesarWebhook(creds, { headers: { "x-rappi-signature": "0".repeat(firmaValida.length) }, query: {}, body }),
    ).rejects.toThrow(/inválida/);
  });

  it("rechaza una firma con el secreto equivocado", async () => {
    const firmaSecretoEquivocado = createHmac("sha256", "otro-secreto").update(JSON.stringify(body)).digest("hex");
    await expect(
      adapter.procesarWebhook(creds, { headers: { "x-rappi-signature": firmaSecretoEquivocado }, query: {}, body }),
    ).rejects.toThrow(/inválida/);
  });

  it("rechaza si falta el header de firma", async () => {
    await expect(adapter.procesarWebhook(creds, { headers: {}, query: {}, body })).rejects.toThrow(/sin firma/);
  });
});

describe("RappiAdapter — probarConexion", () => {
  afterEach(() => jest.restoreAllMocks());

  it("devuelve ok:false si no hay RAPPI_API_BASE_URL configurado", async () => {
    const adapter = new RappiAdapter({ get: () => undefined } as any);
    const resultado = await adapter.probarConexion(credenciales());
    expect(resultado.ok).toBe(false);
    expect(resultado.detalle).toMatch(/RAPPI_API_BASE_URL/);
  });

  it("devuelve ok:true si el host responde 2xx", async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "{}" });
    const adapter = new RappiAdapter({ get: () => "https://api-sandbox.rappi.test" } as any);
    const resultado = await adapter.probarConexion(credenciales());
    expect(resultado.ok).toBe(true);
  });
});
