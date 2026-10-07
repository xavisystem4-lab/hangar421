import { validarNuevoModificador, type BorradorModificador } from "./nuevoModificador";

const base = (cambio: Partial<BorradorModificador> = {}): BorradorModificador => ({
  nombre: "Tipo de leche",
  tipo: "SELECCION_UNICA",
  obligatorio: true,
  opciones: [{ nombre: "Entera", precio: "" }, { nombre: "Avena", precio: "10" }],
  ...cambio,
});

describe("validarNuevoModificador", () => {
  it("acepta un grupo válido: precio vacío = $0, coma decimal y signo $", () => {
    const r = validarNuevoModificador(base({ opciones: [{ nombre: " Entera ", precio: "" }, { nombre: "Avena", precio: "$10,5" }] }));
    expect(r).toEqual({
      ok: true,
      valor: { nombre: "Tipo de leche", tipo: "SELECCION_UNICA", obligatorio: true, opciones: [{ nombre: "Entera", precioExtra: 0 }, { nombre: "Avena", precioExtra: 10.5 }] },
    });
  });

  it("conserva el id de las opciones que ya existían (edición) y deja sin id las nuevas", () => {
    const r = validarNuevoModificador(base({ opciones: [{ id: "op-1", nombre: "Entera", precio: "" }, { nombre: "Almendra", precio: "12" }] }));
    expect(r.ok && r.valor.opciones).toEqual([{ id: "op-1", nombre: "Entera", precioExtra: 0 }, { nombre: "Almendra", precioExtra: 12 }]);
  });

  it("ignora las filas totalmente vacías", () => {
    const r = validarNuevoModificador(base({ opciones: [{ nombre: "Entera", precio: "" }, { nombre: "", precio: "" }, { nombre: "  ", precio: " " }] }));
    expect(r.ok && r.valor.opciones).toEqual([{ nombre: "Entera", precioExtra: 0 }]);
  });

  it("conserva 'varias opciones' y no obligatorio", () => {
    const r = validarNuevoModificador(base({ tipo: "MULTIPLE", obligatorio: false }));
    expect(r.ok && [r.valor.tipo, r.valor.obligatorio]).toEqual(["MULTIPLE", false]);
  });

  it.each([
    ["sin nombre", { nombre: "  " }, "nombre del modificador"],
    ["sin opciones", { opciones: [{ nombre: "", precio: "" }] }, "al menos una opción"],
    ["precio sin nombre", { opciones: [{ nombre: "", precio: "10" }] }, "tiene precio pero no nombre"],
    ["precio negativo", { opciones: [{ nombre: "X", precio: "-5" }] }, "no es válido"],
    ["precio no numérico", { opciones: [{ nombre: "X", precio: "abc" }] }, "no es válido"],
    ["opción repetida", { opciones: [{ nombre: "Avena", precio: "" }, { nombre: " avena ", precio: "5" }] }, "repetida"],
  ])("rechaza %s", (_caso: string, cambio: Partial<BorradorModificador>, texto: string) => {
    const r = validarNuevoModificador(base(cambio));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain(texto);
  });

  it("rechaza un nombre que ya existe, sin distinguir mayúsculas", () => {
    const r = validarNuevoModificador(base({ nombre: "tipo DE leche" }), ["Tamaño", "Tipo de leche"]);
    expect(!r.ok && r.error).toContain("Ya existe");
  });
});
