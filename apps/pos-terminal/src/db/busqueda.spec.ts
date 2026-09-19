import { normalizarTexto, coincideBusqueda, generarSlug } from "./busqueda";

describe("normalizarTexto", () => {
  it("pasa a minúsculas", () => {
    expect(normalizarTexto("Latte Chicago")).toBe("latte chicago");
  });

  it("pliega los acentos del catálogo real", () => {
    expect(normalizarTexto("Bebidas frías")).toBe("bebidas frias");
    expect(normalizarTexto("Café de bebé (choco milk)")).toBe("cafe de bebe (choco milk)");
    expect(normalizarTexto("Dirty Piña Colada")).toBe("dirty pina colada");
  });

  it("pliega la diéresis del proveedor de los roles", () => {
    expect(normalizarTexto("Roles de Canela by Törtchen")).toBe("roles de canela by tortchen");
  });
});

describe("coincideBusqueda", () => {
  it("encuentra sin escribir el acento", () => {
    expect(coincideBusqueda("Café de bebé (choco milk)", "cafe")).toBe(true);
    expect(coincideBusqueda("Dirty Piña Colada", "pina")).toBe(true);
  });

  it("encuentra aunque el acento sí se escriba", () => {
    expect(coincideBusqueda("Café de bebé (choco milk)", "café")).toBe(true);
  });

  it("busca por cualquier parte del nombre, no solo el principio", () => {
    expect(coincideBusqueda("Matcha Iced Latte", "latte")).toBe(true);
  });

  it("ignora mayúsculas y espacios alrededor", () => {
    expect(coincideBusqueda("Flat White", "  FLAT ")).toBe(true);
  });

  it("no coincide con algo que no está", () => {
    expect(coincideBusqueda("Flat White", "croissant")).toBe(false);
  });

  it("un término vacío coincide con todo — la pantalla no necesita un caso especial", () => {
    expect(coincideBusqueda("Lo que sea", "")).toBe(true);
    expect(coincideBusqueda("Lo que sea", "   ")).toBe(true);
  });
});

describe("generarSlug", () => {
  it("produce un slug estable y sin acentos", () => {
    expect(generarSlug("Bebidas frías")).toBe("bebidas-frias");
    expect(generarSlug("Café de bebé (choco milk)")).toBe("cafe-de-bebe-choco-milk");
  });

  it("no deja guiones sueltos en los extremos", () => {
    expect(generarSlug("  H & T  ")).toBe("h-t");
  });

  it("es determinista", () => {
    expect(generarSlug("Roles de Canela by Törtchen")).toBe(generarSlug("Roles de Canela by Törtchen"));
  });
});
