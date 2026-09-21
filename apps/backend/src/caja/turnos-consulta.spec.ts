import { esTurnoDeDiaAnterior } from "./turnos-consulta";

const MX = "America/Mexico_City"; // UTC-6 en septiembre

describe("esTurnoDeDiaAnterior", () => {
  const ahora = new Date("2026-09-21T14:00:00Z"); // 08:00 del 21 en México

  it("un turno abierto ayer por la noche ya está pendiente esta mañana", () => {
    expect(esTurnoDeDiaAnterior({ estado: "ABIERTO", fechaApertura: new Date("2026-09-21T04:00:00Z") }, MX, ahora)).toBe(true); // 22:00 del 20
  });

  it("uno abierto hoy temprano no lo está", () => {
    expect(esTurnoDeDiaAnterior({ estado: "ABIERTO", fechaApertura: new Date("2026-09-21T12:30:00Z") }, MX, ahora)).toBe(false); // 06:30 del 21
  });

  it("el corte del día es el de la sucursal, no UTC: las 19:00 del 20 en México ya son el 21 en UTC", () => {
    expect(esTurnoDeDiaAnterior({ estado: "ABIERTO", fechaApertura: new Date("2026-09-21T01:00:00Z") }, MX, ahora)).toBe(true);
  });

  it("un turno cerrado nunca está pendiente", () => {
    expect(esTurnoDeDiaAnterior({ estado: "CERRADO", fechaApertura: new Date("2026-09-19T14:00:00Z") }, MX, ahora)).toBe(false);
  });
});
