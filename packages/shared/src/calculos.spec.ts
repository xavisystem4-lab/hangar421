import { TipoDescuento, TipoMovimientoInventario } from "./enums";
import {
  calcularCortesia,
  cobroEnDolares,
  efectivoEsperadoPorMoneda,
  calcularDiferenciaTraspaso,
  calcularImpuesto,
  calcularMontoDescuento,
  calcularDescuentosVenta,
  calcularNivelInventario,
  calcularPorcionesDisponibles,
  calcularSubtotal,
  calcularTotalesPedido,
  deltaExistenciaInventario,
  resumenSemaforoInventario,
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
  it("calcula subtotal y total sin descuentos — los precios del catálogo ya son finales, no se suma impuesto encima", () => {
    const totales = calcularTotalesPedido(
      [{ precioUnitario: 49, cantidad: 2 }, { precioUnitario: 65, cantidad: 1 }],
      [],
      0.16,
    );
    expect(totales.subtotal).toBe(163);
    expect(totales.descuentoTotal).toBe(0);
    expect(totales.impuesto).toBe(0);
    expect(totales.total).toBe(163);
  });

  it("el descuento se resta directo del subtotal, sin impuesto de por medio", () => {
    const totales = calcularTotalesPedido(
      [{ precioUnitario: 100, cantidad: 1 }],
      [{ tipo: TipoDescuento.PORCENTAJE, valor: 10 }],
      0.16,
    );
    expect(totales.subtotal).toBe(100);
    expect(totales.descuentoTotal).toBe(10);
    expect(totales.impuesto).toBe(0);
    expect(totales.total).toBe(90);
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

describe("calcularNivelInventario", () => {
  it("es CRITICO en o por debajo del mínimo", () => {
    expect(calcularNivelInventario(2, 20).nivel).toBe("CRITICO");
    expect(calcularNivelInventario(20, 20).nivel).toBe("CRITICO");
  });

  it("es BAJO entre el mínimo y 1.5x el mínimo", () => {
    expect(calcularNivelInventario(25, 20).nivel).toBe("BAJO");
  });

  it("es OPTIMO por encima de 1.5x el mínimo", () => {
    expect(calcularNivelInventario(35, 12).nivel).toBe("OPTIMO");
  });

  it("sin mínimo capturado siempre es OPTIMO (no hay referencia para juzgar)", () => {
    expect(calcularNivelInventario(5, 0).nivel).toBe("OPTIMO");
  });

  it("el porcentaje usa el máximo como referencia cuando está definido", () => {
    expect(calcularNivelInventario(50, 20, 100).porcentaje).toBe(50);
  });

  it("el porcentaje usa 2x el mínimo como referencia cuando no hay máximo", () => {
    expect(calcularNivelInventario(12, 12).porcentaje).toBe(50);
  });

  it("el porcentaje nunca pasa de 100 aunque la existencia exceda la referencia", () => {
    expect(calcularNivelInventario(500, 12).porcentaje).toBe(100);
  });
});

describe("calcularCortesia", () => {
  it("regala todo cuando no se cobra ningún extra", () => {
    expect(calcularCortesia(85, 0)).toEqual({ montoCortesia: 85, total: 0 });
  });

  it("cobra solo los extras elegidos", () => {
    expect(calcularCortesia(105, 20)).toEqual({ montoCortesia: 85, total: 20 });
  });

  it("nunca cobra más que el subtotal ni montos negativos", () => {
    expect(calcularCortesia(50, 80)).toEqual({ montoCortesia: 0, total: 50 });
    expect(calcularCortesia(50, -5)).toEqual({ montoCortesia: 50, total: 0 });
  });
});

describe("cobroEnDolares", () => {
  it("US$20 a $18.50 cubre una cuenta de $300 y deja $70 de cambio en pesos", () => {
    expect(cobroEnDolares(300, 20, 18.5)).toEqual({ equivalenteMxn: 370, suficiente: true, faltanteMxn: 0, cambioMxn: 70 });
  });

  it("dice cuánto falta si los dólares no alcanzan", () => {
    expect(cobroEnDolares(300, 10, 18.5)).toEqual({ equivalenteMxn: 185, suficiente: false, faltanteMxn: 115, cambioMxn: 0 });
  });

  it("sin tipo de cambio no se puede cobrar en dólares", () => {
    expect(cobroEnDolares(0, 20, 0).suficiente).toBe(false);
  });
});

describe("efectivoEsperadoPorMoneda", () => {
  it("separa pesos y dólares, y el cambio de un pago en dólares sale de los pesos", () => {
    expect(
      efectivoEsperadoPorMoneda({
        montoInicial: 500,
        pagos: [
          { metodo: "EFECTIVO", monto: 120 },
          { metodo: "EFECTIVO_USD", monto: 300, montoUsd: 20, tipoCambio: 18.5 },
          { metodo: "TARJETA", monto: 250 },
        ],
        ingresos: 50,
        egresos: 30,
      }),
    ).toEqual({ mxn: 570, usd: 20 }); // 500 + 120 + 50 − 30 − 70 de cambio
  });
});

describe("calcularDescuentosVenta", () => {
  const lineas = [
    { precioUnitario: 50, cantidad: 2, modificadoresPrecio: 10 }, // línea de $120
    { precioUnitario: 80, cantidad: 1 }, // línea de $80
  ];

  it("sin descuentos el total es el subtotal", () => {
    const r = calcularDescuentosVenta(lineas);
    expect(r).toMatchObject({ subtotal: 200, descuentoTotal: 0, total: 200, porLinea: [0, 0] });
  });

  it("descuento general por porcentaje sobre toda la cuenta", () => {
    const r = calcularDescuentosVenta(lineas, { tipo: TipoDescuento.PORCENTAJE, valor: 10 });
    expect(r.descuentoGeneral).toBe(20);
    expect(r.total).toBe(180);
  });

  it("descuento general por monto fijo", () => {
    expect(calcularDescuentosVenta(lineas, { tipo: TipoDescuento.MONTO, valor: 35 }).total).toBe(165);
  });

  it("descuento por producto solo toca esa línea (el monto fijo es de la línea completa)", () => {
    const r = calcularDescuentosVenta([{ ...lineas[0], descuento: { tipo: TipoDescuento.MONTO, valor: 30 } }, lineas[1]]);
    expect(r.porLinea).toEqual([30, 0]);
    expect(r.descuentoProductos).toBe(30);
    expect(r.total).toBe(170);
  });

  it("un descuento por producto nunca excede el valor de su línea", () => {
    const r = calcularDescuentosVenta([{ ...lineas[1], descuento: { tipo: TipoDescuento.MONTO, valor: 500 } }]);
    expect(r.porLinea).toEqual([80]);
    expect(r.total).toBe(0);
  });

  it("el general se calcula DESPUÉS de los descuentos por producto", () => {
    const r = calcularDescuentosVenta(
      [{ ...lineas[0], descuento: { tipo: TipoDescuento.PORCENTAJE, valor: 50 } }, lineas[1]], // -60 → quedan 140
      { tipo: TipoDescuento.PORCENTAJE, valor: 10 }, // 10% de 140 = 14
    );
    expect(r).toMatchObject({ descuentoProductos: 60, descuentoGeneral: 14, descuentoTotal: 74, total: 126 });
  });

  it("rechaza descuentos negativos", () => {
    expect(() => calcularDescuentosVenta(lineas, { tipo: TipoDescuento.MONTO, valor: -1 })).toThrow();
  });
});

describe("resumenSemaforoInventario", () => {
  it("cuenta cuántos insumos hay en cada color", () => {
    expect(resumenSemaforoInventario(["OPTIMO", "CRITICO", "BAJO", "CRITICO"])).toEqual({ optimo: 1, bajo: 1, critico: 2, total: 4 });
    expect(resumenSemaforoInventario([])).toEqual({ optimo: 0, bajo: 0, critico: 0, total: 0 });
  });
});

describe("calcularPorcionesDisponibles", () => {
  const receta = [
    { insumoId: "leche", cantidad: 0.25 }, // litros por café
    { insumoId: "cafe", cantidad: 18 }, // gramos por café
  ];

  it("las porciones son el mínimo entre insumos, redondeado hacia abajo, y señala el limitante", () => {
    const r = calcularPorcionesDisponibles(receta, { leche: 10, cafe: 100 }); // 40 cafés de leche, 5 de café
    expect(r).toEqual({ porciones: 5, limitante: { insumoId: "cafe", porciones: 5 } });
  });

  it("un insumo sin registro en la sucursal cuenta como 0", () => {
    expect(calcularPorcionesDisponibles(receta, { leche: 10 }).porciones).toBe(0);
  });

  it("sin receta no se puede saber (null)", () => {
    expect(calcularPorcionesDisponibles([], { leche: 10 })).toEqual({ porciones: null, limitante: null });
  });

  it("no se deja engañar por el punto flotante (0.3 / 0.1 son 3 porciones, no 2)", () => {
    expect(calcularPorcionesDisponibles([{ insumoId: "x", cantidad: 0.1 }], { x: 0.3 }).porciones).toBe(3);
  });

  it("ignora cantidades de receta en 0 y existencias negativas", () => {
    expect(calcularPorcionesDisponibles([{ insumoId: "x", cantidad: 0 }, { insumoId: "y", cantidad: 2 }], { x: 0, y: -4 }).porciones).toBe(0);
  });
});
