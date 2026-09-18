import { necesitaRevalidacion, CADENCIA_REVALIDACION_DIAS_DEFAULT } from "./revalidacion";

describe("necesitaRevalidacion", () => {
  it("es true si nunca se ha revalidado (null)", () => {
    expect(necesitaRevalidacion(null, CADENCIA_REVALIDACION_DIAS_DEFAULT)).toBe(true);
  });

  it("es false justo después de una revalidación reciente", () => {
    const ahora = new Date("2026-09-17T12:00:00Z");
    const haceUnaHora = new Date("2026-09-17T11:00:00Z").toISOString();
    expect(necesitaRevalidacion(haceUnaHora, 14, ahora)).toBe(false);
  });

  it("es false un día antes de cumplir la cadencia", () => {
    const ahora = new Date("2026-09-17T12:00:00Z");
    const hace13dias = new Date("2026-09-04T12:00:00Z").toISOString();
    expect(necesitaRevalidacion(hace13dias, 14, ahora)).toBe(false);
  });

  it("es true justo al cumplir la cadencia", () => {
    const ahora = new Date("2026-09-17T12:00:00Z");
    const hace14dias = new Date("2026-09-03T12:00:00Z").toISOString();
    expect(necesitaRevalidacion(hace14dias, 14, ahora)).toBe(true);
  });

  it("es true muy después de la cadencia", () => {
    const ahora = new Date("2026-09-17T12:00:00Z");
    const hace30dias = new Date("2026-08-18T12:00:00Z").toISOString();
    expect(necesitaRevalidacion(hace30dias, 14, ahora)).toBe(true);
  });
});
