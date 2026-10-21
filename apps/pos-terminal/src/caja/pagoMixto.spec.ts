import { armarPagosMixtos } from "./pagoMixto";

describe("armarPagosMixtos", () => {
  it("efectivo + tarjeta cubren el total exacto", () => {
    const r = armarPagosMixtos(250, [{ metodo: "EFECTIVO", cantidad: 100 }, { metodo: "TARJETA", cantidad: 150 }], null);
    expect(r.error).toBeNull();
    expect(r.faltante).toBe(0);
    expect(r.cambio).toBe(0);
    expect(r.pagos).toEqual([{ metodo: "TARJETA", monto: 150 }, { metodo: "EFECTIVO", monto: 100, montoRecibido: 100 }]);
  });

  it("el efectivo da cambio y solo cubre lo que falta", () => {
    const r = armarPagosMixtos(250, [{ metodo: "TRANSFERENCIA", cantidad: 100 }, { metodo: "EFECTIVO", cantidad: 200 }], null);
    expect(r.cambio).toBe(50);
    expect(r.pagos[1]).toEqual({ metodo: "EFECTIVO", monto: 150, montoRecibido: 200 });
  });

  it("tarjeta no puede pasar del total", () => {
    expect(armarPagosMixtos(100, [{ metodo: "TARJETA", cantidad: 120 }], null).error).toMatch(/no dan cambio/);
  });

  it("dólares al tipo de cambio + pesos", () => {
    const r = armarPagosMixtos(300, [{ metodo: "EFECTIVO_USD", cantidad: 10 }, { metodo: "EFECTIVO", cantidad: 200 }], 18);
    expect(r.pagos[0]).toEqual({ metodo: "EFECTIVO_USD", monto: 180, montoUsd: 10, tipoCambio: 18 });
    expect(r.pagos[1]).toEqual({ metodo: "EFECTIVO", monto: 120, montoRecibido: 200 });
    expect(r.cambio).toBe(80);
  });

  it("reporta lo que falta", () => {
    expect(armarPagosMixtos(250, [{ metodo: "TARJETA", cantidad: 100 }], null).faltante).toBe(150);
  });
});
