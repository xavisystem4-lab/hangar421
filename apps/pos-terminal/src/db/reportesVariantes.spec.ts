import { agruparVariantes, etiquetaProductoVendido } from "./reportesRepo";

const SEP = "\u001f";

describe("agruparVariantes", () => {
  it("agrupa por combinación de modificadores sin importar el orden y ordena por cantidad", () => {
    const v = agruparVariantes([
      { producto_id: "latte", cantidad: 1, mods: `Grande${SEP}Leche de avena` },
      { producto_id: "latte", cantidad: 1, mods: `Leche de avena${SEP}Grande` },
      { producto_id: "latte", cantidad: 1, mods: "Chico" },
    ]);
    expect(v.get("latte")).toEqual([
      { descripcion: "Grande · Leche de avena", cantidad: 2 },
      { descripcion: "Chico", cantidad: 1 },
    ]);
  });

  it("los renglones sin modificadores se cuentan como 'Sin modificadores' cuando conviven con otros", () => {
    const v = agruparVariantes([
      { producto_id: "latte", cantidad: 2, mods: null },
      { producto_id: "latte", cantidad: 1, mods: "Grande" },
    ]);
    expect(v.get("latte")).toEqual([
      { descripcion: "Sin modificadores", cantidad: 2 },
      { descripcion: "Grande", cantidad: 1 },
    ]);
  });

  it("un producto que nunca llevó modificadores no tiene desglose", () => {
    const v = agruparVariantes([{ producto_id: "sandwich", cantidad: 5, mods: null }]);
    expect(v.get("sandwich")).toEqual([]);
  });
});

describe("etiquetaProductoVendido", () => {
  const lista = [
    { nombre: "Latte", categoria: "Bebidas calientes", cantidad: 3, total: 150 },
    { nombre: "Latte", categoria: "DIDI", cantidad: 3, total: 180 },
    { nombre: "Sándwich", categoria: "Alimentos", cantidad: 5, total: 300 },
  ];
  it("agrega la categoría solo cuando hay otro producto con el mismo nombre", () => {
    expect(etiquetaProductoVendido(lista[0], lista)).toBe("Latte (Bebidas calientes)");
    expect(etiquetaProductoVendido(lista[1], lista)).toBe("Latte (DIDI)");
    expect(etiquetaProductoVendido(lista[2], lista)).toBe("Sándwich");
  });
});
