import { TipoDescuento, TipoMovimientoInventario } from "./enums";
import {
  calcularDiferenciaTraspaso,
  calcularImpuesto,
  calcularMontoDescuento,
  calcularSubtotal,
  calcularTotalesPedido,
  deltaExistenciaInventario,
  round2,
  validarPagoSuficiente,
} from "./calculos";

describe("calcularSubtotal", () => {
  it("suma precio * cantidad, incluyendo el precio de los modificadores", () => {
    const subtotal = calcularSubtotal([
      { precioUnitario: 49, cantidad: 2, modificadoresPrecio: 15 }, // 2x Latte + shot extra
      { precioUnitario: 65, cantidad: 1 }, // Croissant, sin modificadores
    ]);
    expect(subtotal).toBe(49 * 2 + 15 * 2 + 65);
  });

  it("redondea a 2 decimales", () => {
    const subtotal = calcularSubtotal([{ precioUnitario: 33.333, cantidad: 3 }]);
    expect(subtotal).toBe(100);
  });
});

describe("calcularImpuesto", () => {
  it("aplica la tasa sobre la base gravable", () => {
    expect(calcularImpuesto(163, 0.16)).toBe(26.08);
  });

  it("nunca es negativo aunque la base lo sea", () => {
    expect(calcularImpuesto(-50, 0.16)).toBe(0);
  });
});

describe("calcularMontoDescuento", () => {
  it("calcula un descuento por porcentaje", () => {
    expect(calcularMontoDescuento(TipoDescuento.PORCENTAJE, 10, 200)).toBe(20);
  });

  it("calcula un descuento por monto fijo", () => {
    expect(calcularMontoDescuento(TipoDescuento.MONTO, 30, 200)).toBe(30);
  });

  it("nunca descuenta más que el subtotal (protección ante error de captura)", () => {
    expect(calcularMontoDescuento(TipoDescuento.MONTO, 500, 200)).toBe(200);
  });

  it("rechaza valores negativos", () => {
    expect(() => calcularMontoDescuento(TipoDescuento.MONTO, -10, 200)).toThrow();
  });
});

describe("calcularTotalesPedido", () => {
  it("calcula subtotal, impuesto y total sin descuentos", () => {
    const totales = calcularTotalesPedido(
      [{ precioUnitario: 49, cantidad: 2 }, { precioUnitario: 65, cantidad: 1 }],
      [],
      0.16,
    );
    expect(totales.subtotal).toBe(163);
    expect(totales.descuentoTotal).toBe(0);
    expect(totales.impuesto).toBe(26.08);
    expect(totales.total).toBe(189.08);
  });

  it("aplica el descuento antes de calcular el impuesto (sobre la base gravable)", () => {
    const totales = calcularTotalesPedido(
      [{ precioUnitario: 100, cantidad: 1 }],
      [{ tipo: TipoDescuento.PORCENTAJE, valor: 10 }],
      0.16,
    );
    expect(totales.subtotal).toBe(100);
    expect(totales.descuentoTotal).toBe(10);
    expect(totales.impuesto).toBe(14.4); // 16% de 90, no de 100
    expect(totales.total).toBe(104.4);
  });

  it("acumula varios descuentos sin exceder el subtotal", () => {
    const totales = calcularTotalesPedido(
      [{ precioUnitario: 100, cantidad: 1 }],
      [
        { tipo: TipoDescuento.PORCENTAJE, valor: 50 }, // -50
        { tipo: TipoDescuento.MONTO, valor: 80 }, // se limita a lo que queda (50)
      ],
      0,
    );
    expect(totales.descuentoTotal).toBe(100);
    expect(totales.total).toBe(0);
  });
});

describe("validarPagoSuficiente (pagos mixtos)", () => {
  it("acepta un pago mixto que cubre exactamente el total", () => {
    const r = validarPagoSuficiente([{ monto: 100 }, { monto: 89.08 }], 189.08);
    expect(r.suficiente).toBe(true);
    expect(r.faltante).toBe(0);
  });

  it("detecta un pago insuficiente y calcula el faltante", () => {
    const r = validarPagoSuficiente([{ monto: 100 }], 189.08);
    expect(r.suficiente).toBe(false);
    expect(r.faltante).toBe(89.08);
  });

  it("acepta sobrepago en efectivo (habrá cambio, se valida en la UI de cobro)", () => {
    const r = validarPagoSuficiente([{ monto: 200 }], 189.08);
    expect(r.suficiente).toBe(true);
    expect(r.totalPagado).toBe(200);
  });
});

describe("deltaExistenciaInventario", () => {
  it("ENTRADA suma la magnitud absoluta", () => {
    expect(deltaExistenciaInventario(TipoMovimientoInventario.ENTRADA, 50)).toBe(50);
  });

  it("SALIDA resta aunque venga positiva", () => {
    expect(deltaExistenciaInventario(TipoMovimientoInventario.SALIDA, 18)).toBe(-18);
  });

  it("MERMA siempre resta magnitud absoluta", () => {
    expect(deltaExistenciaInventario(TipoMovimientoInventario.MERMA, -5)).toBe(-5);
  });

  it("TRASPASO_ENTRADA suma y TRASPASO_SALIDA resta", () => {
    expect(deltaExistenciaInventario(TipoMovimientoInventario.TRASPASO_ENTRADA, 10)).toBe(10);
    expect(deltaExistenciaInventario(TipoMovimientoInventario.TRASPASO_SALIDA, 10)).toBe(-10);
  });

  it("AJUSTE y CONTEO respetan el signo enviado por el cliente", () => {
    expect(deltaExistenciaInventario(TipoMovimientoInventario.AJUSTE, -7)).toBe(-7);
    expect(deltaExistenciaInventario(TipoMovimientoInventario.CONTEO, 3)).toBe(3);
  });
});

describe("calcularDiferenciaTraspaso", () => {
  it("es cero cuando lo recibido coincide con lo enviado", () => {
    expect(calcularDiferenciaTraspaso(100, 100)).toBe(0);
  });

  it("es negativa cuando hay merma en tránsito", () => {
    expect(calcularDiferenciaTraspaso(100, 95)).toBe(-5);
  });

  it("es positiva cuando llega más de lo enviado", () => {
    expect(calcularDiferenciaTraspaso(100, 102)).toBe(2);
  });
});

describe("round2", () => {
  it("evita errores de punto flotante comunes", () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });
});
