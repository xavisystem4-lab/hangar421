import { diasDeTurnoAbierto, turnoDeDiaAnterior } from "./turnos";

// Fechas construidas en hora LOCAL (sin "Z"): la regla es por día de calendario del equipo.
const hoy8am = new Date(2026, 8, 21, 8, 0);

describe("turnoDeDiaAnterior", () => {
  it("un turno abierto anoche ya está pendiente esta mañana, aunque hayan pasado pocas horas", () => {
    expect(turnoDeDiaAnterior({ estado: "ABIERTO", fechaApertura: new Date(2026, 8, 20, 22, 0) }, hoy8am)).toBe(true);
  });

  it("uno abierto hoy de madrugada no lo está", () => {
    expect(turnoDeDiaAnterior({ estado: "ABIERTO", fechaApertura: new Date(2026, 8, 21, 0, 30) }, hoy8am)).toBe(false);
  });

  it("un turno cerrado nunca está pendiente", () => {
    expect(turnoDeDiaAnterior({ estado: "CERRADO", fechaApertura: new Date(2026, 8, 18, 9, 0) }, hoy8am)).toBe(false);
  });

  it("acepta la fecha como texto ISO (así viene de la API y de SQLite)", () => {
    expect(turnoDeDiaAnterior({ estado: "ABIERTO", fechaApertura: new Date(2026, 8, 19, 9, 0).toISOString() }, hoy8am)).toBe(true);
  });

  it("una fecha ilegible no dispara el aviso", () => {
    expect(turnoDeDiaAnterior({ estado: "ABIERTO", fechaApertura: "no-es-fecha" }, hoy8am)).toBe(false);
  });
});

describe("diasDeTurnoAbierto", () => {
  it("cuenta días de calendario", () => {
    expect(diasDeTurnoAbierto(new Date(2026, 8, 20, 23, 0), hoy8am)).toBe(1);
    expect(diasDeTurnoAbierto(new Date(2026, 8, 18, 9, 0), hoy8am)).toBe(3);
    expect(diasDeTurnoAbierto(new Date(2026, 8, 21, 7, 0), hoy8am)).toBe(0);
  });
});
