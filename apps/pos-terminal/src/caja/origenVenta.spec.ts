import { carritoMezclaDidi, esVentaDidi, etiquetaOrigen, origenDePlataforma } from "./origenVenta";

describe("origenVenta", () => {
  it("es venta DiDi solo si todo el carrito es del grupo DIDI", () => {
    expect(esVentaDidi(["DIDI", "DIDI"])).toBe(true);
    expect(esVentaDidi(["didi"])).toBe(true);
    expect(esVentaDidi(["DIDI", "Bebidas"])).toBe(false);
    expect(esVentaDidi(["Bebidas"])).toBe(false);
    expect(esVentaDidi([])).toBe(false);
    expect(esVentaDidi([undefined])).toBe(false);
  });

  it("detecta el carrito mezclado para advertir", () => {
    expect(carritoMezclaDidi(["DIDI", "Postres"])).toBe(true);
    expect(carritoMezclaDidi(["DIDI"])).toBe(false);
    expect(carritoMezclaDidi(["Postres"])).toBe(false);
  });

  it("traduce la plataforma de la integración", () => {
    expect(origenDePlataforma("didi")).toBe("DIDI");
    expect(origenDePlataforma("Uber")).toBe("UBER");
    expect(origenDePlataforma("rappi")).toBe("RAPPI");
    expect(origenDePlataforma("otra")).toBeNull();
    expect(origenDePlataforma(null)).toBeNull();
  });

  it("rotula el origen; lo desconocido es mostrador", () => {
    expect(etiquetaOrigen("DIDI")).toBe("DiDi Food");
    expect(etiquetaOrigen(null)).toBe("Mostrador");
    expect(etiquetaOrigen("X")).toBe("Mostrador");
  });
});
