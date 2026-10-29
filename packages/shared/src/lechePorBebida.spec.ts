import { ajusteDeLeche, esColdFoam, esShot, gramosDeLeche, lechePorOmision } from "./lechePorBebida";
import { consumoDeVenta } from "./inventarioConsumo";

const icedLatte = { base: 240, conColdFoam: 190, conShot: 240, conAmbos: 150 };
const icedMatcha = { base: 200, conColdFoam: 150, conShot: 170, conAmbos: 130 };

describe("gramosDeLeche", () => {
  it("usa la cantidad de cada caso de la hoja", () => {
    expect(gramosDeLeche(icedLatte, { coldFoam: false, shot: false })).toBe(240);
    expect(gramosDeLeche(icedLatte, { coldFoam: true, shot: false })).toBe(190);
    expect(gramosDeLeche(icedLatte, { coldFoam: true, shot: true })).toBe(150);
    expect(gramosDeLeche(icedMatcha, { coldFoam: false, shot: true })).toBe(170);
  });

  it("si un caso no está capturado cae al más parecido", () => {
    const solo = { base: 200, conColdFoam: 160 };
    expect(gramosDeLeche(solo, { coldFoam: true, shot: true })).toBe(160);
    expect(gramosDeLeche(solo, { coldFoam: false, shot: true })).toBe(200);
    expect(gramosDeLeche({ base: 120 }, { coldFoam: true, shot: true })).toBe(120);
  });

  it("sin base no hay ajuste", () => {
    expect(gramosDeLeche({ base: null, conColdFoam: 100 }, { coldFoam: true, shot: false })).toBeNull();
  });
});

describe("clasificación de opciones", () => {
  it("reconoce cold foam y shot, no sus negaciones", () => {
    expect(esColdFoam({ grupo: "Cold Foam", opcion: "Vainilla" })).toBe(true);
    expect(esColdFoam({ grupo: "Extras", opcion: "Cold foam vainilla" })).toBe(true);
    expect(esColdFoam({ grupo: "Extras", opcion: "Sin cold foam" })).toBe(false);
    expect(esShot({ opcion: "Shot extra" })).toBe(true);
    expect(esShot({ opcion: "Sin shot" })).toBe(false);
  });
});

describe("ajusteDeLeche + consumoDeVenta", () => {
  const recetas = {
    porProducto: { latte: [{ insumoId: "cafe", cantidad: 20 }] },
    porOpcion: {
      entera: [{ insumoId: "leche", cantidad: 240 }],
      proteina: [{ insumoId: "lecheProt", cantidad: 240 }, { insumoId: "polvoProt", cantidad: 30 }],
      shot: [{ insumoId: "cafe", cantidad: 20 }],
      cfVainilla: [{ insumoId: "crema", cantidad: 50 }],
    },
  };

  it("Iced Latte con cold foam y shot baja 150 g de leche", () => {
    const opciones = [
      { opcionModificadorId: "entera", grupo: "Tipo de leche", opcion: "Entera" },
      { opcionModificadorId: "shot", grupo: "Extras", opcion: "Shot extra" },
      { opcionModificadorId: "cfVainilla", grupo: "Cold Foam", opcion: "Vainilla" },
    ];
    const leche = ajusteDeLeche(icedLatte, opciones);
    expect(leche).toEqual({ gramos: 150, opcionIds: ["entera"] });
    const consumo = consumoDeVenta([{ productoId: "latte", cantidad: 2, modificadores: opciones, leche }], recetas);
    expect(consumo).toEqual([
      { insumoId: "cafe", cantidad: 80 },
      { insumoId: "crema", cantidad: 100 },
      { insumoId: "leche", cantidad: 300 },
    ]);
  });

  it("solo cambia la leche, no el polvo de proteína", () => {
    const opciones = [{ opcionModificadorId: "proteina", grupo: "Tipo de leche", opcion: "Con proteína" }];
    const leche = ajusteDeLeche({ base: 200 }, opciones);
    const consumo = consumoDeVenta([{ productoId: "x", cantidad: 1, modificadores: opciones, leche }], recetas);
    expect(consumo).toEqual([
      { insumoId: "lecheProt", cantidad: 200 },
      { insumoId: "polvoProt", cantidad: 30 },
    ]);
  });

  it("bebida sin leche definida conserva los 240 g de la opción", () => {
    const opciones = [{ opcionModificadorId: "entera", grupo: "Tipo de leche", opcion: "Entera" }];
    expect(ajusteDeLeche({ base: null }, opciones)).toBeNull();
    expect(ajusteDeLeche(null, opciones)).toBeNull();
    const consumo = consumoDeVenta([{ productoId: "x", cantidad: 1, modificadores: opciones }], recetas);
    expect(consumo).toEqual([{ insumoId: "leche", cantidad: 240 }]);
  });
});

describe("leche por omisión (bebida con leche vendida sin elegir leche)", () => {
  const recetas = { porProducto: { spooky: [{ insumoId: "vasoPlastico", cantidad: 1 }] }, porOpcion: {} };

  it("descuenta los gramos de la bebida de la leche entera", () => {
    const leche = ajusteDeLeche({ base: 190 }, [], "lecheEntera");
    expect(leche).toEqual({ gramos: 190, opcionIds: [], insumoPorOmision: "lecheEntera" });
    expect(consumoDeVenta([{ productoId: "spooky", cantidad: 2, modificadores: [], leche }], recetas)).toEqual([
      { insumoId: "lecheEntera", cantidad: 380 },
      { insumoId: "vasoPlastico", cantidad: 2 },
    ]);
  });

  it("con solo el tamaño elegido también aplica (no hay opción de leche)", () => {
    const leche = ajusteDeLeche({ base: 240, conShot: 200 }, [{ opcionModificadorId: "chico", grupo: "Tamaño", opcion: "Chico" }], "lecheEntera");
    expect(leche).toEqual({ gramos: 240, opcionIds: [], insumoPorOmision: "lecheEntera" });
  });

  it("si eligieron una leche, se usa esa y no la de omisión", () => {
    const leche = ajusteDeLeche({ base: 240 }, [{ opcionModificadorId: "avena", grupo: "Tipo de leche", opcion: "Avena" }], "lecheEntera");
    expect(leche).toEqual({ gramos: 240, opcionIds: ["avena"] });
  });

  it("sin leche por bebida o sin leche entera en el catálogo no inventa nada", () => {
    expect(ajusteDeLeche(null, [], "lecheEntera")).toBeNull();
    expect(ajusteDeLeche({ base: 240 }, [], null)).toBeNull();
  });

  it("lechePorOmision toma la línea principal de la opción Entera de un grupo de leche", () => {
    expect(lechePorOmision([
      { grupo: "Tipo de leche", opcion: "Entera", receta: [{ insumoId: "lecheEntera", cantidad: 240 }] },
      { grupo: "Tipo de leche (DiDi)", opcion: "Leche entera", receta: [{ insumoId: "lecheEntera", cantidad: 240 }] },
      { grupo: "Tipo de leche", opcion: "Avena", receta: [{ insumoId: "lecheAvena", cantidad: 240 }] },
      { grupo: "Extras", opcion: "Entera", receta: [{ insumoId: "otro", cantidad: 1 }] },
    ])).toBe("lecheEntera");
    expect(lechePorOmision([{ grupo: "Tipo de leche", opcion: "Avena", receta: [{ insumoId: "a", cantidad: 240 }] }])).toBeNull();
  });
});
