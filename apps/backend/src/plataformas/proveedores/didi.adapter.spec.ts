// La verificación de firma de webhook es la única línea de defensa contra un webhook falsificado
// (ver el mismo razonamiento en mercadopago.adapter.spec.ts) — si esto falla, cualquiera podría
// mandar un "pedido recibido" falso a /plataformas/webhooks/didi/:webhookSlug.

import { createHmac } from "crypto";
import { DidiAdapter } from "./didi.adapter";
import { CredencialesPlataforma } from "./plataforma-delivery.interface";

function credenciales(overrides: Partial<CredencialesPlataforma["extra"]> = {}): CredencialesPlataforma {
  return {
    ambiente: "SANDBOX",
    identificadorTienda: "tienda-1",
    extra: { apiKey: "clave-larga-1234", clientSecret: "secreto-didi", ...overrides },
  };
}

describe("DidiAdapter — validarConfiguracion", () => {
  const adapter = new DidiAdapter({ get: () => undefined } as any);

  it("lanza si falta apiKey", () => {
    const creds = credenciales({ apiKey: "" });
    expect(() => adapter.validarConfiguracion(creds)).toThrow(/API Key/);
  });

  it("lanza si falta clientSecret", () => {
    const creds = credenciales({ clientSecret: "" });
    expect(() => adapter.validarConfiguracion(creds)).toThrow(/Client Secret/);
  });

  it("lanza si falta identificadorTienda", () => {
    const creds = { ...credenciales(), identificadorTienda: null };
    expect(() => adapter.validarConfiguracion(creds)).toThrow(/tienda/);
  });

  it("no lanza con configuración completa", () => {
    expect(() => adapter.validarConfiguracion(credenciales())).not.toThrow();
  });
});

describe("DidiAdapter — campoPrincipalEnmascarado / tieneClientSecret", () => {
  const adapter = new DidiAdapter({ get: () => undefined } as any);

  it("devuelve los últimos 4 caracteres del apiKey", () => {
    expect(adapter.campoPrincipalEnmascarado(credenciales({ apiKey: "abcdef1234" }))).toBe("1234");
  });

  it("reporta si hay clientSecret configurado", () => {
    expect(adapter.tieneClientSecret(credenciales())).toBe(true);
    expect(adapter.tieneClientSecret(credenciales({ clientSecret: "" }))).toBe(false);
  });
});

describe("DidiAdapter — verificación de firma de webhook (privado, vía procesarWebhook)", () => {
  const adapter = new DidiAdapter({ get: () => undefined } as any);
  const creds = credenciales();
  const body = { event_id: "evt-1", order_id: "ord-1", event_type: "order.created", status: "recibido" };
  const firmaValida = createHmac("sha256", creds.extra.clientSecret).update(JSON.stringify(body)).digest("hex");

  it("acepta una firma válida y devuelve el evento parseado", async () => {
    const resultado = await adapter.procesarWebhook(creds, {
      headers: { "x-didi-signature": firmaValida },
      query: {},
      body,
    });
    expect(resultado.eventoExternoId).toBe("evt-1");
    expect(resultado.orden?.ordenExternaId).toBe("ord-1");
  });

  it("rechaza una firma alterada", async () => {
    await expect(
      adapter.procesarWebhook(creds, { headers: { "x-didi-signature": "0".repeat(firmaValida.length) }, query: {}, body }),
    ).rejects.toThrow(/inválida/);
  });

  it("rechaza una firma calculada con el secreto equivocado", async () => {
    const firmaSecretoEquivocado = createHmac("sha256", "otro-secreto").update(JSON.stringify(body)).digest("hex");
    await expect(
      adapter.procesarWebhook(creds, { headers: { "x-didi-signature": firmaSecretoEquivocado }, query: {}, body }),
    ).rejects.toThrow(/inválida/);
  });

  it("rechaza si falta el header de firma", async () => {
    await expect(adapter.procesarWebhook(creds, { headers: {}, query: {}, body })).rejects.toThrow(/sin firma/);
  });

  it("lanza si el payload no trae un id de evento reconocible", async () => {
    const bodySinId = { order_id: "ord-1" };
    const firma = createHmac("sha256", creds.extra.clientSecret).update(JSON.stringify(bodySinId)).digest("hex");
    await expect(
      adapter.procesarWebhook(creds, { headers: { "x-didi-signature": firma }, query: {}, body: bodySinId }),
    ).rejects.toThrow(/sin id de evento/);
  });
});

describe("DidiAdapter — probarConexion", () => {
  afterEach(() => jest.restoreAllMocks());

  it("devuelve ok:false si no hay DIDI_API_BASE_URL configurado", async () => {
    const adapter = new DidiAdapter({ get: () => undefined } as any);
    const resultado = await adapter.probarConexion(credenciales());
    expect(resultado.ok).toBe(false);
    expect(resultado.detalle).toMatch(/DIDI_API_BASE_URL/);
  });

  it("devuelve ok:true si el host responde 2xx", async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "{}" });
    const adapter = new DidiAdapter({ get: () => "https://api-sandbox.didi.test" } as any);
    const resultado = await adapter.probarConexion(credenciales());
    expect(resultado.ok).toBe(true);
  });

  it("devuelve ok:false si el host responde un error", async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "{}" });
    const adapter = new DidiAdapter({ get: () => "https://api-sandbox.didi.test" } as any);
    const resultado = await adapter.probarConexion(credenciales());
    expect(resultado.ok).toBe(false);
  });
});
