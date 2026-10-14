import { aplicarPendientes, tipoDeMovimiento } from "./existenciaLocal";

describe("aplicarPendientes", () => {
  it("resta encima de la cifra oficial lo que vendió la tablet y aún no sube", () => {
    const r = aplicarPendientes(new Map([["leche", 4080]]), [
      { insumoId: "leche", tipo: "RESTAR", cantidad: 240, fecha: "2026-10-14T10:00:00Z" },
      { insumoId: "leche", tipo: "RESTAR", cantidad: 240, fecha: "2026-10-14T10:05:00Z" },
    ]);
    expect(r.get("leche")).toBe(3600);
  });

  it("un conteo fija la cifra y solo cuenta lo posterior a él", () => {
    const r = aplicarPendientes(new Map([["cafe", 1240]]), [
      { insumoId: "cafe", tipo: "RESTAR", cantidad: 20, fecha: "2026-10-14T07:55:00Z" },
      { insumoId: "cafe", tipo: "FIJAR", cantidad: 1000, fecha: "2026-10-14T08:00:00Z" },
      { insumoId: "cafe", tipo: "RESTAR", cantidad: 20, fecha: "2026-10-14T08:05:00Z" },
    ]);
    expect(r.get("cafe")).toBe(980);
  });

  it("ordena por fecha aunque lleguen desordenados y no toca otros insumos", () => {
    const r = aplicarPendientes(new Map([["vasos", 50], ["tapas", 10]]), [
      { insumoId: "vasos", tipo: "SUMAR", cantidad: 100, fecha: "2026-10-14T09:00:00Z" },
      { insumoId: "vasos", tipo: "FIJAR", cantidad: 20, fecha: "2026-10-14T08:00:00Z" },
    ]);
    expect(r.get("vasos")).toBe(120);
    expect(r.has("tapas")).toBe(false);
  });

  it("un insumo sin cifra oficial parte de cero", () => {
    expect(aplicarPendientes(new Map(), [{ insumoId: "nuevo", tipo: "SUMAR", cantidad: 5, fecha: "x" }]).get("nuevo")).toBe(5);
  });
});

describe("tipoDeMovimiento", () => {
  it("CONTEO fija, ENTRADA y AJUSTE suman, lo demás resta", () => {
    expect(tipoDeMovimiento("CONTEO")).toBe("FIJAR");
    expect(tipoDeMovimiento("ENTRADA")).toBe("SUMAR");
    expect(tipoDeMovimiento("AJUSTE")).toBe("SUMAR");
    expect(tipoDeMovimiento("MERMA")).toBe("RESTAR");
    expect(tipoDeMovimiento("SALIDA")).toBe("RESTAR");
  });
});
