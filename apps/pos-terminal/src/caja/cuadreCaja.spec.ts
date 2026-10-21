import { evaluarCuadre, textoDiferencia } from "./cuadreCaja";

describe("evaluarCuadre", () => {
  it("los dólares cubren lo que falta en pesos (venta en dólares marcada como pesos)", () => {
    const r = evaluarCuadre({ contadoMXN: 1015, esperadoMXN: 1125, contadoUSD: 7, esperadoUSD: 0, tipoCambio: 15.72 });
    expect(r.cuadra).toBe(true);
    expect(Math.abs(r.diferencia)).toBeLessThan(1);
  });

  it("un faltante de $21 no cuadra", () => {
    const r = evaluarCuadre({ contadoMXN: 979, esperadoMXN: 1000, contadoUSD: 0, esperadoUSD: 0, tipoCambio: 17 });
    expect(r).toEqual({ diferencia: -21, cuadra: false, sinTipoCambio: false });
    expect(textoDiferencia(r.diferencia)).toBe("Faltan $21.00");
  });

  it("al peso cuadra", () => {
    expect(evaluarCuadre({ contadoMXN: 1000, esperadoMXN: 1000, contadoUSD: 0, esperadoUSD: 0, tipoCambio: null }).cuadra).toBe(true);
  });

  it("sin tipo de cambio y con dólares de más, no cuadra", () => {
    const r = evaluarCuadre({ contadoMXN: 900, esperadoMXN: 1000, contadoUSD: 7, esperadoUSD: 0, tipoCambio: null });
    expect(r.cuadra).toBe(false);
    expect(r.sinTipoCambio).toBe(true);
  });
});
