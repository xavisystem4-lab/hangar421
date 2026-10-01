import { extrasCobrables, motivoCortesia, totalesConCortesia } from "./cortesia";
import type { ItemCarrito } from "../store/carritoStore";

const ITEMS: ItemCarrito[] = [
  {
    id: "l1",
    productoId: "latte",
    nombreProducto: "Latte",
    cantidad: 2,
    precioUnitario: 55,
    modificadores: [
      { opcionModificadorId: "grande", nombreOpcion: "Grande", precioExtra: 0 },
      { opcionModificadorId: "avena", nombreOpcion: "Leche de avena", precioExtra: 10 },
      { opcionModificadorId: "shot", nombreOpcion: "Shot extra", precioExtra: 15 },
    ],
  },
  { id: "l2", productoId: "croissant", nombreProducto: "Croissant", cantidad: 1, precioUnitario: 45, modificadores: [] },
];

// Subtotal: (55 + 10 + 15) × 2 + 45 = 205.
const TOTALES = { subtotal: 205, descuentoTotal: 0, impuesto: 0, total: 205 };

describe("cortesía", () => {
  it("lista solo los extras con precio, multiplicados por la cantidad de la línea", () => {
    expect(extrasCobrables(ITEMS)).toEqual([
      { clave: "l1:avena", nombreProducto: "Latte", nombreExtra: "Leche de avena", precioExtra: 10, cantidad: 2, importe: 20 },
      { clave: "l1:shot", nombreProducto: "Latte", nombreExtra: "Shot extra", precioExtra: 15, cantidad: 2, importe: 30 },
    ]);
  });

  it("sin extras cobrados todo es cortesía", () => {
    expect(totalesConCortesia(TOTALES, ITEMS, [])).toEqual({ subtotal: 205, descuentoTotal: 205, impuesto: 0, total: 0 });
  });

  it("cobra solo los extras elegidos", () => {
    expect(totalesConCortesia(TOTALES, ITEMS, ["l1:avena"])).toEqual({ subtotal: 205, descuentoTotal: 185, impuesto: 0, total: 20 });
    expect(totalesConCortesia(TOTALES, ITEMS, ["l1:avena", "l1:shot"]).total).toBe(50);
  });

  it("arma el motivo con quién autorizó y qué se cobró", () => {
    expect(motivoCortesia("Ana López", ITEMS, ["l1:shot"])).toBe("Cortesía — autorizó Ana López — se cobró: Shot extra");
    expect(motivoCortesia("Ana López", ITEMS, [])).toBe("Cortesía — autorizó Ana López");
  });
});
