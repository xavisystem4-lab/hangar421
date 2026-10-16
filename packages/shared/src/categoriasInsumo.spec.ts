import { agruparPorSeccion, seccionDeInsumo } from "./categoriasInsumo";

const s = (nombre: string, esPreparacion = false) => seccionDeInsumo({ nombre, esPreparacion });

describe("seccionDeInsumo", () => {
  it("usa el prefijo 'Sección - Nombre' cuando lo hay", () => {
    expect(s("Limpieza - Pinol")).toBe("Limpieza");
    expect(s("Plásticos - Vasos de cartón")).toBe("Desechables");
    expect(s("Delivery - Bolsas grandes")).toBe("Delivery");
    expect(s("Polvos - Matcha")).toBe("Polvos");
    expect(s("Refreshers - Agua de coco")).toBe("Bebidas y refreshers");
    expect(s("Postres - Rol de queso")).toBe("Postres");
  });

  it("sin prefijo útil, clasifica por palabras clave", () => {
    expect(s("Leche-Avena")).toBe("Leches");
    expect(s("Leche- Deslactosada")).toBe("Leches");
    expect(s("Jarabe-Datil")).toBe("Jarabes y mieles");
    expect(s("Miel de Agave")).toBe("Jarabes y mieles");
    expect(s("Cafe en grano")).toBe("Café");
    expect(s("Insumos - Crema para batir")).toBe("Postres");
    expect(s("Insumos - Cajeta")).toBe("Jarabes y mieles");
    expect(s("Insumos - Lechera")).toBe("Jarabes y mieles");
    expect(s("MUFFIN CALABAZA")).toBe("Postres");
    expect(s("To - go Bomba")).toBe("Desechables");
    expect(s("Aguacate")).toBe("Cocina");
    expect(s("Hielo en cubos")).toBe("Bebidas y refreshers");
  });

  it("las preparaciones de la casa van aparte", () => {
    expect(s("Cold Foam Spooky", true)).toBe("Preparaciones");
  });

  it("lo que no reconoce cae en Otros", () => {
    expect(s("Cosa rara")).toBe("Otros");
  });
});

describe("agruparPorSeccion", () => {
  it("respeta el orden de secciones y ordena por nombre dentro de cada una", () => {
    const g = agruparPorSeccion([{ nombre: "Limpieza - Pinol" }, { nombre: "Leche-Avena" }, { nombre: "Leche-Almendras" }]);
    expect(g.map((x) => x.seccion)).toEqual(["Leches", "Limpieza"]);
    expect(g[0].items.map((x) => x.nombre)).toEqual(["Leche-Almendras", "Leche-Avena"]);
  });
});
