import { colorDeCategoria, coloresPorCategoria, conOpacidad } from "./coloresCategoria";

describe("colorDeCategoria", () => {
  it("reconoce las categorías del menú por su nombre, con o sin acentos y en mayúsculas", () => {
    expect(colorDeCategoria("BEBIDAS FRÍAS").fondo).toBe("#1E40AF"); // azul rey
    expect(colorDeCategoria("Bebidas frias").fondo).toBe("#1E40AF");
    expect(colorDeCategoria("BEBIDAS CALIENTES").fondo).toBe("#C62828"); // rojo
    expect(colorDeCategoria("Cafés").fondo).toBe("#C62828");
    expect(colorDeCategoria("POSTRES").fondo).toBe("#6D4C41"); // café
    expect(colorDeCategoria("Postres de temporada").fondo).toBe("#6D4C41"); // postre gana a temporada
    expect(colorDeCategoria("Combos").fondo).toBe("#2E7D32");
    expect(colorDeCategoria("DIDI").fondo).toBe("#E65100");
    expect(colorDeCategoria("De Temporada").fondo).toBe("#6A1B9A");
    expect(colorDeCategoria("Bagels").fondo).toBe("#B45309");
  });

  it("el texto siempre es blanco", () => {
    expect(colorDeCategoria("Bebidas frías").texto).toBe("#FFFFFF");
    expect(colorDeCategoria("Cualquier cosa", 3).texto).toBe("#FFFFFF");
  });

  it("un nombre desconocido recibe un color de la paleta según su posición, distinto para vecinas", () => {
    const a = colorDeCategoria("Zzz", 0).fondo;
    const b = colorDeCategoria("Zzz", 1).fondo;
    expect(a).not.toBe(b);
    expect(colorDeCategoria("Zzz", 10).fondo).toBe(a); // la paleta se recorre en círculo
    expect(colorDeCategoria("Zzz", -1).fondo).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it("coloresPorCategoria asigna por id usando la posición como respaldo", () => {
    const m = coloresPorCategoria([{ id: "c1", nombre: "Bebidas frías" }, { id: "c2", nombre: "Misc" }, { id: "c3", nombre: "Otra" }]);
    expect(m.get("c1")?.fondo).toBe("#1E40AF");
    expect(m.get("c2")?.fondo).not.toBe(m.get("c3")?.fondo);
  });

  it("conOpacidad agrega el canal alfa en hexadecimal", () => {
    expect(conOpacidad("#1E40AF", 1)).toBe("#1E40AFFF");
    expect(conOpacidad("#1E40AF", 0.5)).toBe("#1E40AF80");
    expect(conOpacidad("#1E40AF", 0)).toBe("#1E40AF00");
  });
});
