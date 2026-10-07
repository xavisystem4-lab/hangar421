import { MAX_NOMBRE_CLIENTE, normalizarNombreCliente, notasConNombreCliente } from "./nombreCliente";

describe("nombreCliente", () => {
  it("recorta y colapsa espacios", () => {
    expect(normalizarNombreCliente("  Ana   María ")).toBe("Ana María");
  });

  it("vacío o solo espacios es 'sin nombre'", () => {
    expect(normalizarNombreCliente("")).toBeNull();
    expect(normalizarNombreCliente("   ")).toBeNull();
    expect(normalizarNombreCliente(null)).toBeNull();
    expect(normalizarNombreCliente(undefined)).toBeNull();
  });

  it("quita saltos de línea y caracteres de control", () => {
    expect(normalizarNombreCliente("Ana\nLópez\t\u0007")).toBe("Ana López");
  });

  it("limita el largo sin dejar espacio colgando", () => {
    const largo = normalizarNombreCliente("A".repeat(10) + " " + "B".repeat(40));
    expect(largo!.length).toBeLessThanOrEqual(MAX_NOMBRE_CLIENTE);
    expect(largo!.endsWith(" ")).toBe(false);
  });

  it("conserva acentos y eñes", () => {
    expect(normalizarNombreCliente("José Núñez")).toBe("José Núñez");
  });

  it("arma las notas del pedido con el nombre primero", () => {
    expect(notasConNombreCliente("Ana", "DiDi #123")).toBe("Cliente: Ana · DiDi #123");
    expect(notasConNombreCliente("Ana", undefined)).toBe("Cliente: Ana");
    expect(notasConNombreCliente(null, "DiDi #123")).toBe("DiDi #123");
    expect(notasConNombreCliente("  ", "")).toBeUndefined();
  });
});
