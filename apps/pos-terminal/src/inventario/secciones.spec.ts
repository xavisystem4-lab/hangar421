import { idSeccionInicial, seccionDeInsumo, seccionSugerida, type SeccionInventario } from "./secciones";

describe("seccionSugerida", () => {
  it.each([
    ["Galletas Costco", "exhibidor"],
    ["Muffin de Plátano", "exhibidor"],
    ["Brownie", "exhibidor"],
    ["Dulce de leche", "refrigerador-1"],
    ["Blue Matcha", "refrigerador-1"],
    ["Cold Brew concentrado", "refrigerador-1"],
    ["Mantequilla", "refrigerador-1"],
    ["Leche entera", "refrigerador-2"],
    ["Leche de almendra", "refrigerador-2"],
    ["Leche deslactosada", "refrigerador-2"],
    ["Vasos 12 oz", "tras-barra"],
    ["Café en grano", "tras-barra"],
    ["Garrafón de agua", "tras-barra"],
    ["Matcha ceremonial", "tras-barra"],
    ["Té verde", "tras-barra"],
  ])("%s → %s", (nombre, esperada) => {
    expect(seccionSugerida(nombre)).toBe(esperada);
  });

  it("las palabras cortas no casan dentro de otras", () => {
    expect(seccionSugerida("Chocolate amargo")).toBeNull(); // "te " no es "chocolate"
    expect(seccionSugerida("Pantalla")).toBeNull(); // "pan " no es "pantalla"
  });

  it("sin coincidencia no propone nada", () => {
    expect(seccionSugerida("Insumo raro")).toBeNull();
  });
});

describe("seccionDeInsumo", () => {
  const suc = "suc-1";
  const secciones: SeccionInventario[] = [
    { id: idSeccionInicial(suc, "exhibidor"), nombre: "Exhibidor", orden: 1, activo: true },
    { id: idSeccionInicial(suc, "refrigerador-2"), nombre: "Refrigerador 2", orden: 3, activo: false },
    { id: "bodega", nombre: "Bodega", orden: 5, activo: true },
  ];

  it("sin asignación usa la sugerida, si esa sección sigue activa", () => {
    expect(seccionDeInsumo({ insumoId: "a", nombre: "Galletas" }, new Map(), secciones, suc)).toBe(idSeccionInicial(suc, "exhibidor"));
    expect(seccionDeInsumo({ insumoId: "b", nombre: "Leche entera" }, new Map(), secciones, suc)).toBeNull(); // Refrigerador 2 de baja
  });

  it("la asignación a mano gana sobre la sugerida, incluido elegir 'sin sección'", () => {
    expect(seccionDeInsumo({ insumoId: "a", nombre: "Galletas" }, new Map([["a", "bodega"]]), secciones, suc)).toBe("bodega");
    expect(seccionDeInsumo({ insumoId: "a", nombre: "Galletas" }, new Map([["a", null]]), secciones, suc)).toBeNull();
  });

  it("una asignación a una sección dada de baja queda sin sección", () => {
    expect(seccionDeInsumo({ insumoId: "c", nombre: "x" }, new Map([["c", idSeccionInicial(suc, "refrigerador-2")]]), secciones, suc)).toBeNull();
  });
});
