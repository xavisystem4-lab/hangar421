import { calcularProximoReintentoMs, yaPuedeReintentar } from "./backoff";

describe("calcularProximoReintentoMs", () => {
  it("empieza en 30s con 0 intentos previos", () => {
    expect(calcularProximoReintentoMs(0)).toBe(30_000);
  });

  it("se duplica en cada intento", () => {
    expect(calcularProximoReintentoMs(1)).toBe(60_000);
    expect(calcularProximoReintentoMs(2)).toBe(120_000);
    expect(calcularProximoReintentoMs(3)).toBe(240_000);
  });

  it("nunca pasa del tope de 15 minutos", () => {
    expect(calcularProximoReintentoMs(10)).toBe(15 * 60_000);
    expect(calcularProximoReintentoMs(100)).toBe(15 * 60_000);
  });
});

describe("yaPuedeReintentar", () => {
  it("es true si nunca se ha programado un reintento (null)", () => {
    expect(yaPuedeReintentar(null)).toBe(true);
  });

  it("es false antes de la hora programada", () => {
    const ahora = new Date("2026-09-17T12:00:00Z");
    const futuro = new Date("2026-09-17T12:05:00Z").toISOString();
    expect(yaPuedeReintentar(futuro, ahora)).toBe(false);
  });

  it("es true justo en la hora programada o después", () => {
    const ahora = new Date("2026-09-17T12:05:00Z");
    const objetivo = new Date("2026-09-17T12:05:00Z").toISOString();
    expect(yaPuedeReintentar(objetivo, ahora)).toBe(true);
  });
});
