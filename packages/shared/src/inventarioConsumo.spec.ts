import { agruparRecetas, consumoDeVenta, creaCicloDePreparacion, expandirPreparaciones } from "./inventarioConsumo";

/**
 * Caso real: la receta del Latte llevaba las cinco leches (240 c/u) y cada venta las descontaba
 * todas. La leche la aporta la opción elegida; la receta del producto, solo lo fijo.
 */
const RECETAS = agruparRecetas(
  [
    { productoId: "latte", insumoId: "cafe", cantidad: 20 },
    { productoId: "latte", insumoId: "vaso", cantidad: 1 },
  ],
  [
    { opcionModificadorId: "avena", insumoId: "leche-avena", cantidad: 240 },
    { opcionModificadorId: "entera", insumoId: "leche-entera", cantidad: 240 },
    { opcionModificadorId: "shot", insumoId: "cafe", cantidad: 10 },
  ],
);

describe("consumoDeVenta", () => {
  it("descuenta solo la leche elegida", () => {
    expect(consumoDeVenta([{ productoId: "latte", cantidad: 1, modificadores: [{ opcionModificadorId: "avena" }] }], RECETAS)).toEqual([
      { insumoId: "cafe", cantidad: 20 },
      { insumoId: "leche-avena", cantidad: 240 },
      { insumoId: "vaso", cantidad: 1 },
    ]);
  });

  it("multiplica por la cantidad del renglón y suma varios renglones", () => {
    const consumo = consumoDeVenta(
      [
        { productoId: "latte", cantidad: 2, modificadores: [{ opcionModificadorId: "avena" }] },
        { productoId: "latte", cantidad: 1, modificadores: [{ opcionModificadorId: "entera" }] },
      ],
      RECETAS,
    );
    expect(consumo).toEqual([
      { insumoId: "cafe", cantidad: 60 },
      { insumoId: "leche-avena", cantidad: 480 },
      { insumoId: "leche-entera", cantidad: 240 },
      { insumoId: "vaso", cantidad: 3 },
    ]);
  });

  it("una opción que comparte insumo con el producto se suma (shot extra de café)", () => {
    expect(consumoDeVenta([{ productoId: "latte", cantidad: 1, modificadores: [{ opcionModificadorId: "shot" }] }], RECETAS)).toEqual([
      { insumoId: "cafe", cantidad: 30 },
      { insumoId: "vaso", cantidad: 1 },
    ]);
  });

  it("la misma opción dos veces consume dos veces", () => {
    expect(consumoDeVenta([{ productoId: "x", cantidad: 1, modificadores: [{ opcionModificadorId: "shot" }, { opcionModificadorId: "shot" }] }], RECETAS)).toEqual([
      { insumoId: "cafe", cantidad: 20 },
    ]);
  });

  it("un producto sin receta no consume nada", () => {
    expect(consumoDeVenta([{ productoId: "sin-receta", cantidad: 5 }], RECETAS)).toEqual([]);
  });

  it("conserva fracciones a 4 decimales", () => {
    const recetas = agruparRecetas([{ productoId: "p", insumoId: "canela", cantidad: 0.1255 }], []);
    expect(consumoDeVenta([{ productoId: "p", cantidad: 3 }], recetas)).toEqual([{ insumoId: "canela", cantidad: 0.3765 }]);
  });
});

describe("preparaciones de la casa (cold foam)", () => {
  // Cold foam blue matcha, por servicio: 35 g crema batida + 15 g agave + 2 g blue matcha.
  const porPreparacion = {
    "cold-foam": [
      { insumoId: "crema", cantidad: 35 },
      { insumoId: "agave", cantidad: 15 },
      { insumoId: "matcha", cantidad: 2 },
    ],
  };

  it("al vender una bebida con cold foam se descuentan sus ingredientes, no la preparación", () => {
    const recetas = {
      porProducto: { "cold-brew": [{ insumoId: "cafe", cantidad: 20 }] },
      porOpcion: { "extra-foam": [{ insumoId: "cold-foam", cantidad: 1 }] },
      porPreparacion,
    };
    const consumo = consumoDeVenta([{ productoId: "cold-brew", cantidad: 2, modificadores: [{ opcionModificadorId: "extra-foam" }] }], recetas);
    expect(consumo).toEqual([
      { insumoId: "agave", cantidad: 30 },
      { insumoId: "cafe", cantidad: 40 },
      { insumoId: "crema", cantidad: 70 },
      { insumoId: "matcha", cantidad: 4 },
    ]);
  });

  it("media porción de preparación descuenta la mitad de cada ingrediente; las que llevan otra se abren en cascada", () => {
    const anidada = { ...porPreparacion, "postre": [{ insumoId: "cold-foam", cantidad: 2 }, { insumoId: "galleta", cantidad: 1 }] };
    expect(expandirPreparaciones([{ insumoId: "cold-foam", cantidad: 0.5 }], porPreparacion)).toEqual([
      { insumoId: "crema", cantidad: 17.5 }, { insumoId: "agave", cantidad: 7.5 }, { insumoId: "matcha", cantidad: 1 },
    ]);
    expect(expandirPreparaciones([{ insumoId: "postre", cantidad: 1 }], anidada)).toEqual([
      { insumoId: "crema", cantidad: 70 }, { insumoId: "agave", cantidad: 30 }, { insumoId: "matcha", cantidad: 4 }, { insumoId: "galleta", cantidad: 1 },
    ]);
  });

  it("un ciclo no cuelga el cálculo y se detecta antes de guardar", () => {
    const ciclo = { a: [{ insumoId: "b", cantidad: 1 }], b: [{ insumoId: "a", cantidad: 1 }] };
    expect(expandirPreparaciones([{ insumoId: "a", cantidad: 1 }], ciclo)).toEqual([{ insumoId: "a", cantidad: 1 }]);
    expect(creaCicloDePreparacion("cold-foam", ["crema", "agave"], porPreparacion)).toBe(false);
    expect(creaCicloDePreparacion("crema", ["cold-foam"], porPreparacion)).toBe(true);
    expect(creaCicloDePreparacion("x", ["x"], {})).toBe(true);
  });

  it("agruparRecetas también agrupa las filas de preparación", () => {
    const r = agruparRecetas([], [], [{ preparacionId: "cold-foam", insumoId: "crema", cantidad: 35 }]);
    expect(r.porPreparacion).toEqual({ "cold-foam": [{ insumoId: "crema", cantidad: 35 }] });
  });
});
