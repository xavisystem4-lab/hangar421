import { MODIFICADORES_HANGAR, MODAL_BEBIDA, PERSONALIZACION_POR_PRODUCTO, idModificadorHangar, idOpcionHangar } from "./modificadoresHangar";
import { PRODUCTOS_HANGAR } from "./catalogoHangar";

// Copiados a mano de apps/backend/src/bootstrap/seed-demo-data.ts, igual que el catálogo. Estas
// pruebas son la red que avisa si las dos copias se separan.
describe("MODIFICADORES_HANGAR", () => {
  it("son los seis del menú", () => {
    expect(MODIFICADORES_HANGAR.map((m) => m.nombre)).toEqual([
      "Tamaño", "Tipo de leche", "Extras", "Jarabe", "Cold Foam", "Jarabe a escoger",
    ]);
  });

  it("marca como obligatorios solo los de selección única que lo son", () => {
    const obligatorios = MODIFICADORES_HANGAR.filter((m) => m.obligatorio).map((m) => m.nombre);
    expect(obligatorios).toEqual(["Tamaño", "Tipo de leche", "Jarabe a escoger"]);
    for (const m of MODIFICADORES_HANGAR) {
      if (m.obligatorio) expect(m.tipo).toBe("SELECCION_UNICA");
    }
  });

  // Si un obligatorio se queda sin opciones, el modal no puede preseleccionar nada y el botón
  // "Agregar" queda deshabilitado para siempre: la venta se bloquea.
  it("todo modificador obligatorio tiene opciones", () => {
    for (const m of MODIFICADORES_HANGAR) {
      if (m.obligatorio) expect(m.opciones.length).toBeGreaterThan(0);
    }
  });

  it("conserva los precios del menú", () => {
    const tamano = MODIFICADORES_HANGAR.find((m) => m.nombre === "Tamaño")!;
    expect(tamano.opciones.map((o) => [o.nombre, o.precioExtra])).toEqual([["Chico", 0], ["Grande", 12], ["XL", 20]]);

    const leche = MODIFICADORES_HANGAR.find((m) => m.nombre === "Tipo de leche")!;
    expect(leche.opciones.find((o) => o.nombre === "Avena")!.precioExtra).toBe(25);
    expect(leche.opciones.find((o) => o.nombre === "Almendra")!.precioExtra).toBe(20);
  });

  // "Jarabe" se cobra sobre una bebida suelta; "Jarabe a escoger" va incluido en el combo.
  it("distingue el jarabe que se cobra del que va incluido en el combo", () => {
    const cobrado = MODIFICADORES_HANGAR.find((m) => m.nombre === "Jarabe")!;
    const incluido = MODIFICADORES_HANGAR.find((m) => m.nombre === "Jarabe a escoger")!;
    expect(cobrado.opciones.every((o) => o.precioExtra === 15)).toBe(true);
    expect(incluido.opciones.every((o) => o.precioExtra === 0)).toBe(true);
  });

  it("no repite ids de modificador", () => {
    const ids = MODIFICADORES_HANGAR.map((m) => idModificadorHangar(m.nombre));
    expect(new Set(ids).size).toBe(ids.length);
  });

  // "Vainilla" existe en Jarabe (15), en Cold Foam (25) y en Jarabe a escoger (0). Un id
  // derivado solo del nombre de la opción las colapsaría en una sola y cobraría de menos.
  it("no repite ids de opción aunque el nombre se repita entre modificadores", () => {
    const ids = MODIFICADORES_HANGAR.flatMap((m) => m.opciones.map((o) => idOpcionHangar(m.nombre, o.nombre)));
    expect(new Set(ids).size).toBe(ids.length);

    const enJarabe = idOpcionHangar("Jarabe", "Vainilla");
    const enColdFoam = idOpcionHangar("Cold Foam", "Vainilla");
    expect(enJarabe).not.toBe(enColdFoam);
  });
});

describe("PERSONALIZACION_POR_PRODUCTO", () => {
  const nombresModificadores = new Set(MODIFICADORES_HANGAR.map((m) => m.nombre));

  it("solo referencia modificadores que existen", () => {
    for (const pregunta of Object.values(PERSONALIZACION_POR_PRODUCTO)) {
      for (const nombre of pregunta) expect(nombresModificadores.has(nombre)).toBe(true);
    }
  });

  // Una clave mal escrita no falla en ningún lado: simplemente el producto deja de preguntar y
  // se cobra el precio base sin extras, en silencio.
  it("solo referencia productos que existen en el catálogo", () => {
    const claves = new Set(PRODUCTOS_HANGAR.map((p) => `${p.categoria}#${p.nombre}`));
    for (const clave of Object.keys(PERSONALIZACION_POR_PRODUCTO)) {
      expect(claves.has(clave)).toBe(true);
    }
  });

  it("las bebidas preparadas preguntan las cinco cosas", () => {
    expect(PERSONALIZACION_POR_PRODUCTO["Bebidas calientes#Latte"]).toEqual(MODAL_BEBIDA);
    expect(MODAL_BEBIDA).toHaveLength(5);
  });

  // No llevaban `*` en el menú: no se preparan a medida y tocar la tarjeta debe agregarlos
  // directo, sin modal, que es lo que mantiene ágil el cobro en barra.
  it("no personaliza los que el menú no personaliza", () => {
    expect(PERSONALIZACION_POR_PRODUCTO["Bebidas calientes#Americano"]).toBeUndefined();
    expect(PERSONALIZACION_POR_PRODUCTO["Bebidas frías#Cold Brew Black Honey"]).toBeUndefined();
    expect(PERSONALIZACION_POR_PRODUCTO["Postres#Macadamia"]).toBeUndefined();
  });

  it("los combos con bebida incluida preguntan solo el jarabe", () => {
    expect(PERSONALIZACION_POR_PRODUCTO["Combos#H & T"]).toEqual(["Jarabe a escoger"]);
    expect(PERSONALIZACION_POR_PRODUCTO["Combos#BnE & T"]).toEqual(["Jarabe a escoger"]);
  });

  it("personaliza 15 productos del menú", () => {
    expect(Object.keys(PERSONALIZACION_POR_PRODUCTO)).toHaveLength(15);
  });
});
