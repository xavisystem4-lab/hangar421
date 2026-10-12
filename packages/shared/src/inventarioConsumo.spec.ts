import { agruparRecetas, consumoDeVenta } from "./inventarioConsumo";

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
