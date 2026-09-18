import { decidirResultadoTicket } from "./decisionImpresion";

describe("decidirResultadoTicket", () => {
  it("es PENDIENTE si la impresora no está disponible", () => {
    expect(decidirResultadoTicket(false, null)).toBe("PENDIENTE");
  });

  it("es PENDIENTE si está disponible pero no llegó resultado", () => {
    expect(decidirResultadoTicket(true, null)).toBe("PENDIENTE");
  });

  it("es PENDIENTE si el adaptador reporta impreso: false", () => {
    expect(decidirResultadoTicket(true, { impreso: false, error: "atasco de papel" })).toBe("PENDIENTE");
  });

  it("es IMPRESO solo si está disponible Y el adaptador confirma impreso: true", () => {
    expect(decidirResultadoTicket(true, { impreso: true })).toBe("IMPRESO");
  });

  it("nunca es IMPRESO si no está disponible, aunque el resultado diga impreso: true", () => {
    expect(decidirResultadoTicket(false, { impreso: true })).toBe("PENDIENTE");
  });
});
