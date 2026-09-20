import {
  BILLETES_MXN, MONEDAS_MXN, BILLETES_USD,
  totalConteo, construirDesglose, calcularDiferencia, round2,
} from "./denominaciones";

describe("denominaciones", () => {
  // Deben ser las mismas que el POS Windows (apps/pos-desktop/src/screens/Caja.tsx): un corte
  // tiene que cuadrar igual se haga en la caja o en la tablet.
  it("coinciden con las del POS Windows", () => {
    expect(BILLETES_MXN).toEqual([1000, 500, 200, 100, 50, 20]);
    expect(MONEDAS_MXN).toEqual([20, 10, 5, 2, 1, 0.5]);
    expect(BILLETES_USD).toEqual([100, 50, 20, 10, 5, 1]);
  });
});

describe("totalConteo", () => {
  it("multiplica cada denominación por sus piezas", () => {
    expect(totalConteo({ 500: 2, 100: 3, 20: 1 })).toBe(1320);
  });

  it("maneja las monedas de 50 centavos sin arrastrar decimales binarios", () => {
    expect(totalConteo({ 0.5: 3 })).toBe(1.5);
    expect(totalConteo({ 0.5: 7, 1: 1 })).toBe(4.5);
  });

  it("un conteo vacío vale cero", () => {
    expect(totalConteo({})).toBe(0);
  });

  // El campo es un TextInput y el cajero puede dejarlo a medio escribir: un NaN colado aquí
  // haría que el total del corte entero fuera NaN y el cierre mandaría basura al ERP.
  it("ignora cantidades vacías, negativas o no numéricas", () => {
    expect(totalConteo({ 100: NaN as any, 50: -3, 20: 2 })).toBe(40);
    expect(totalConteo({ 100: undefined as any })).toBe(0);
  });
});

describe("construirDesglose", () => {
  it("suma billetes y monedas MXN en totalMXN", () => {
    const d = construirDesglose({ 200: 2 }, { 10: 5 }, {});
    expect(d.totalMXN).toBe(450);
  });

  // Mismo criterio que el POS Windows: el dólar es informativo hasta que alguien lo cambie a
  // pesos en una operación aparte. Sumarlo descuadraría todos los cortes de un local que
  // acepte dólares.
  it("deja el dólar aparte, sin sumarlo al total en pesos", () => {
    const d = construirDesglose({ 100: 1 }, {}, { 20: 3 });
    expect(d.totalMXN).toBe(100);
    expect(d.totalUSD).toBe(60);
  });

  it("conserva el conteo tal cual, para poder auditarlo después", () => {
    const d = construirDesglose({ 500: 1 }, { 5: 2 }, { 10: 1 });
    expect(d.billetesMXN).toEqual({ 500: 1 });
    expect(d.monedasMXN).toEqual({ 5: 2 });
    expect(d.billetesUSD).toEqual({ 10: 1 });
  });

  it("omite unas observaciones vacías en vez de mandar cadena vacía", () => {
    expect(construirDesglose({}, {}, {}, "   ").observaciones).toBeUndefined();
    expect(construirDesglose({}, {}, {}, "  faltó cambio ").observaciones).toBe("faltó cambio");
  });
});

describe("calcularDiferencia", () => {
  it("positiva cuando sobra dinero en caja", () => {
    expect(calcularDiferencia(1050, 1000)).toBe(50);
  });

  it("negativa cuando falta", () => {
    expect(calcularDiferencia(950, 1000)).toBe(-50);
  });

  it("cero exacto cuando cuadra, sin residuos de coma flotante", () => {
    expect(calcularDiferencia(round2(0.1 + 0.2), 0.3)).toBe(0);
  });
});
