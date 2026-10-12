import { aPaquetes, aUnidadBase, describirEnPaquetes, tienePresentacion } from "./presentacion";

const CARTON = { nombre: "Cartón", porPaquete: 1000 };

describe("aUnidadBase", () => {
  it("convierte cartones y sueltos a la unidad base", () => {
    expect(aUnidadBase({ paquetes: 4, sueltos: 0 }, 1000)).toBe(4000);
    expect(aUnidadBase({ paquetes: 2, sueltos: 300 }, 1000)).toBe(2300);
    expect(aUnidadBase({ paquetes: 0, sueltos: 450 }, 1000)).toBe(450);
  });

  it("los campos vacíos o con texto cuentan como cero", () => {
    expect(aUnidadBase({ paquetes: NaN, sueltos: 300 }, 1000)).toBe(300);
    expect(aUnidadBase({}, 1000)).toBe(0);
  });

  it("admite medios paquetes", () => {
    expect(aUnidadBase({ paquetes: 1.5, sueltos: 0 }, 1000)).toBe(1500);
  });
});

describe("aPaquetes", () => {
  it("parte la existencia en empaques completos y lo suelto", () => {
    expect(aPaquetes(4000, 1000)).toEqual({ paquetes: 4, sueltos: 0 });
    expect(aPaquetes(2300, 1000)).toEqual({ paquetes: 2, sueltos: 300 });
    expect(aPaquetes(750, 1000)).toEqual({ paquetes: 0, sueltos: 750 });
  });

  it("sin presentación todo queda como suelto", () => {
    expect(aPaquetes(2300, 1)).toEqual({ paquetes: 0, sueltos: 2300 });
    expect(aPaquetes(2300, 0)).toEqual({ paquetes: 0, sueltos: 2300 });
  });

  it("una existencia negativa se lee con el mismo signo", () => {
    expect(aPaquetes(-2300, 1000)).toEqual({ paquetes: -2, sueltos: -300 });
  });

  it("ida y vuelta no pierde cantidad", () => {
    const { paquetes, sueltos } = aPaquetes(3750.5, 1000);
    expect(aUnidadBase({ paquetes, sueltos }, 1000)).toBe(3750.5);
  });
});

describe("describirEnPaquetes", () => {
  it("usa singular y plural del empaque", () => {
    expect(describirEnPaquetes(1000, CARTON, "ml")).toBe("1 Cartón");
    expect(describirEnPaquetes(4000, CARTON, "ml", "Cartones")).toBe("4 Cartones");
  });

  it("muestra el sobrante aparte", () => {
    expect(describirEnPaquetes(2300, CARTON, "ml", "Cartones")).toBe("2 Cartones + 300 ml");
  });

  it("por debajo de un empaque muestra la unidad base", () => {
    expect(describirEnPaquetes(750, CARTON, "ml")).toBe("750 ml");
  });

  it("sin presentación devuelve la cantidad en unidad base", () => {
    expect(describirEnPaquetes(2300, null, "ml")).toBe("2300 ml");
    expect(describirEnPaquetes(5, { nombre: "", porPaquete: 1000 }, "pz")).toBe("5 pz");
  });
});

describe("tienePresentacion", () => {
  it("exige nombre y un tamaño mayor que 1", () => {
    expect(tienePresentacion(CARTON)).toBe(true);
    expect(tienePresentacion({ nombre: "Cartón", porPaquete: 1 })).toBe(false);
    expect(tienePresentacion({ nombre: "  ", porPaquete: 1000 })).toBe(false);
    expect(tienePresentacion(null)).toBe(false);
  });
});
