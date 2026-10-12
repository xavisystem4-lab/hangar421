import { emparejarConCatalogo, extraerLineasProducto, pedidoListoParaConfirmar, totalItems, type ProductoCatalogo } from "./productosDidi";

const CATALOGO: ProductoCatalogo[] = [
  { id: "latte-mostrador", nombre: "Latte", subcategoria: "Bebidas calientes", categoria: "Café", precio: 70 },
  { id: "latte-didi", nombre: "Latte", subcategoria: "Bebidas calientes", categoria: "DIDI", precio: 85 },
  { id: "frappe-moka", nombre: "Frappé Moka", subcategoria: null, categoria: "DIDI", precio: 95 },
  { id: "cold-brew", nombre: "Cold Brew Blue Matcha", subcategoria: null, categoria: "DIDI", precio: 99 },
];

describe("extraerLineasProducto", () => {
  it("lee los formatos habituales, uno por renglón", () => {
    expect(extraerLineasProducto("Nuevo pedido #123\n2x Latte\nFrappé moka x1\n1 Cold brew blue matcha $99.00\nTotal: $269")).toEqual([
      { cantidad: 2, nombre: "Latte", precio: null },
      { cantidad: 1, nombre: "Frappé moka", precio: null },
      { cantidad: 1, nombre: "Cold brew blue matcha", precio: 99 },
    ]);
  });

  it("varios en una sola línea separados por coma o punto medio", () => {
    expect(extraerLineasProducto("2 x Latte, 1 x Frappé Moka · 1× Cold Brew").map((l) => `${l.cantidad} ${l.nombre}`)).toEqual([
      "2 Latte", "1 Frappé Moka", "1 Cold Brew",
    ]);
  });

  it("si la notificación no trae productos, no inventa ninguno", () => {
    expect(extraerLineasProducto("Tienes un pedido nuevo #A1B2 de Ana por $180.00")).toEqual([]);
  });
});

describe("emparejarConCatalogo", () => {
  it("prefiere el producto del grupo DIDI y marca exacto / aproximado / sin pareja", () => {
    const items = emparejarConCatalogo(
      [{ cantidad: 2, nombre: "latte", precio: null }, { cantidad: 1, nombre: "Cold brew matcha", precio: null }, { cantidad: 1, nombre: "Sandwich", precio: null }],
      CATALOGO,
    );
    expect(items[0]).toMatchObject({ productoId: "latte-didi", precioUnitario: 85, coincidencia: "exacto", cantidad: 2 });
    expect(items[1]).toMatchObject({ productoId: "cold-brew", coincidencia: "aproximado" });
    expect(items[2]).toMatchObject({ productoId: null, coincidencia: null });
    expect(pedidoListoParaConfirmar(items)).toBe(false);
    expect(pedidoListoParaConfirmar(items.slice(0, 2))).toBe(true);
    expect(totalItems(items.slice(0, 2))).toBe(269);
  });
});
