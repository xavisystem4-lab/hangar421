import { elegirInsumoCafe, mermaPorCalibraciones } from "./calibraciones";

describe("mermaPorCalibraciones", () => {
  it("20 g por calibración", () => {
    expect(mermaPorCalibraciones(3, "g")).toBe(60);
  });
  it("convierte si el café está en kilos", () => {
    expect(mermaPorCalibraciones(2, "kg")).toBe(0.04);
  });
  it("cero, negativos o texto no registran nada", () => {
    expect(mermaPorCalibraciones(0, "g")).toBe(0);
    expect(mermaPorCalibraciones(-2, "g")).toBe(0);
    expect(mermaPorCalibraciones(Number("abc"), "g")).toBe(0);
  });
});

describe("elegirInsumoCafe", () => {
  const i = (nombre: string, unidadMedida = "g", activo = true) => ({ nombre, unidadMedida, activo });
  it("prefiere 'Café en grano' activo y en peso", () => {
    expect(elegirInsumoCafe([i("Bolsa de café", "pz"), i("Cafe en grano"), i("Café molido")])?.nombre).toBe("Cafe en grano");
  });
  it("ignora dados de baja y los que no se miden en peso", () => {
    expect(elegirInsumoCafe([i("Cafe en grano", "g", false), i("Café en grano", "pz"), i("Café molido", "kg")])?.nombre).toBe("Café molido");
  });
  it("sin café devuelve null", () => {
    expect(elegirInsumoCafe([i("Leche-Avena")])).toBeNull();
  });
});
