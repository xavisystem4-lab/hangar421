import { CATEGORIAS_HANGAR, PRODUCTOS_HANGAR, idCategoriaHangar, idProductoHangar } from "./catalogoHangar";

// El catálogo está duplicado a mano desde apps/backend/src/bootstrap/seed-demo-data.ts (el APK no
// puede alcanzar la base de la PC). Estas pruebas son la red que avisa si las dos copias se
// separan: fijan el conteo por categoría y la integridad de los ids.
describe("CATEGORIAS_HANGAR", () => {
  it("son las 7 del menú, en el mismo orden que el backend", () => {
    expect(CATEGORIAS_HANGAR.map((c) => c.nombre)).toEqual([
      "Combos", "Bebidas frías", "Bebidas calientes", "Postres", "Refresher", "Para llevar", "Extras",
    ]);
  });

  it("no repite ids", () => {
    const ids = CATEGORIAS_HANGAR.map((c) => idCategoriaHangar(c.nombre));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("PRODUCTOS_HANGAR", () => {
  it("tiene los 34 productos del menú", () => {
    expect(PRODUCTOS_HANGAR).toHaveLength(34);
  });

  it("reparte los productos por categoría como el backend", () => {
    const porCategoria: Record<string, number> = {};
    for (const p of PRODUCTOS_HANGAR) porCategoria[p.categoria] = (porCategoria[p.categoria] ?? 0) + 1;
    expect(porCategoria).toEqual({
      "Bebidas frías": 10,
      "Bebidas calientes": 7,
      Postres: 7,
      Combos: 4,
      Refresher: 3,
      "Para llevar": 2,
      Extras: 1,
    });
  });

  it("cada producto apunta a una categoría que existe", () => {
    const nombres = new Set(CATEGORIAS_HANGAR.map((c) => c.nombre));
    for (const p of PRODUCTOS_HANGAR) expect(nombres.has(p.categoria)).toBe(true);
  });

  it("no repite ids aunque el menú repita nombres", () => {
    const ids = PRODUCTOS_HANGAR.map(idProductoHangar);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // El caso que rompería un id derivado solo del nombre: mismo nombre, categorías o precios
  // distintos. Si alguien "simplifica" idProductoHangar, estas dos caen.
  it("distingue los homónimos de distinta categoría", () => {
    const latteFrio = PRODUCTOS_HANGAR.find((p) => p.nombre === "Latte" && p.categoria === "Bebidas frías")!;
    const latteCaliente = PRODUCTOS_HANGAR.find((p) => p.nombre === "Latte" && p.categoria === "Bebidas calientes")!;
    expect(latteFrio.precio).toBe(85);
    expect(latteCaliente.precio).toBe(70);
    expect(idProductoHangar(latteFrio)).not.toBe(idProductoHangar(latteCaliente));
  });

  it("distingue los homónimos de la misma categoría por precio", () => {
    const bagels = PRODUCTOS_HANGAR.filter((p) => p.nombre === "Solo Bagel");
    expect(bagels).toHaveLength(2);
    expect(new Set(bagels.map(idProductoHangar)).size).toBe(2);

    const pistaches = PRODUCTOS_HANGAR.filter((p) => p.nombre === "Pistache");
    expect(pistaches).toHaveLength(2);
    expect(new Set(pistaches.map(idProductoHangar)).size).toBe(2);
  });

  it("todo homónimo lleva subcategoría — es lo único que lo desambigua en pantalla", () => {
    const conteo: Record<string, number> = {};
    for (const p of PRODUCTOS_HANGAR) conteo[`${p.categoria}#${p.nombre}`] = (conteo[`${p.categoria}#${p.nombre}`] ?? 0) + 1;
    for (const p of PRODUCTOS_HANGAR) {
      if (conteo[`${p.categoria}#${p.nombre}`] > 1) expect(p.subcategoria).toBeTruthy();
    }
  });

  it("no tiene precios inválidos", () => {
    for (const p of PRODUCTOS_HANGAR) expect(p.precio).toBeGreaterThan(0);
  });

  it("los ids se distinguen a simple vista de los UUID del ERP", () => {
    for (const p of PRODUCTOS_HANGAR) expect(idProductoHangar(p).startsWith("hangar-prod-")).toBe(true);
  });
});
