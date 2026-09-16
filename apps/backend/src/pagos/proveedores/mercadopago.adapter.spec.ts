import { createHmac } from "crypto";
import { MercadoPagoAdapter } from "./mercadopago.adapter";
import { CredencialesProveedor } from "./proveedor-pago.interface";

/** La verificación de firma es la única línea de defensa contra un webhook falsificado que
 *  intente marcar un pago como APROBADO sin que Mercado Pago lo haya confirmado de verdad — se
 *  prueba contra el algoritmo documentado oficialmente (manifest "id:...;request-id:...;ts:...;",
 *  HMAC-SHA256, ver el comentario en mercadopago.adapter.ts -> verificarFirma). */
describe("MercadoPagoAdapter — verificación de firma de webhook", () => {
  const credenciales: CredencialesProveedor = {
    ambiente: "PRUEBAS",
    identificadorComercio: null,
    webhookUrl: null,
    extra: { accessToken: "tok", webhookSecret: "secreto-de-prueba" },
  };

  function firmar(dataId: string, requestId: string, ts: string, secret: string) {
    const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
    return createHmac("sha256", secret).update(manifest).digest("hex");
  }

  it("acepta una firma válida", () => {
    const adapter = new MercadoPagoAdapter();
    const ts = "1700000000000";
    const dataId = "order-123";
    const v1 = firmar(dataId, "req-1", ts, "secreto-de-prueba");

    expect(() =>
      (adapter as any).verificarFirma(credenciales, {
        headers: { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": "req-1" },
        query: { "data.id": dataId },
      }),
    ).not.toThrow();
  });

  it("rechaza una firma con hash alterado", () => {
    const adapter = new MercadoPagoAdapter();
    const ts = "1700000000000";
    expect(() =>
      (adapter as any).verificarFirma(credenciales, {
        headers: { "x-signature": `ts=${ts},v1=${"0".repeat(64)}`, "x-request-id": "req-1" },
        query: { "data.id": "order-123" },
      }),
    ).toThrow(/inválida/);
  });

  it("rechaza una firma calculada con el secreto equivocado (webhook de otra cuenta/tenant)", () => {
    const adapter = new MercadoPagoAdapter();
    const ts = "1700000000000";
    const dataId = "order-123";
    const v1 = firmar(dataId, "req-1", ts, "otro-secreto-distinto");

    expect(() =>
      (adapter as any).verificarFirma(credenciales, {
        headers: { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": "req-1" },
        query: { "data.id": dataId },
      }),
    ).toThrow(/inválida/);
  });

  it("rechaza si falta el header x-signature", () => {
    const adapter = new MercadoPagoAdapter();
    expect(() =>
      (adapter as any).verificarFirma(credenciales, { headers: {}, query: { "data.id": "order-123" } }),
    ).toThrow(/sin x-signature/);
  });

  it("mapea los estados de orden de Mercado Pago a los estados internos correctamente", () => {
    const adapter = new MercadoPagoAdapter();
    const mapear = (s: string) => (adapter as any).mapearEstadoOrden(s).estado;
    expect(mapear("created")).toBe("ENVIADO_A_TERMINAL");
    expect(mapear("at_terminal")).toBe("EN_PROCESO");
    expect(mapear("action_required")).toBe("EN_PROCESO");
    expect(mapear("processed")).toBe("APROBADO");
    expect(mapear("canceled")).toBe("CANCELADO");
    expect(mapear("failed")).toBe("RECHAZADO");
    expect(mapear("expired")).toBe("ERROR");
  });
});
