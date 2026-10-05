import { motivoTurnoInvalido, normalizarHora, textoTurno } from "./turnosTrabajoRepo";

describe("normalizarHora", () => {
  it("rellena la hora a dos dígitos", () => {
    expect(normalizarHora("7:05")).toBe("07:05");
    expect(normalizarHora(" 15:00 ")).toBe("15:00");
  });

  it("rechaza formatos u horas imposibles", () => {
    for (const h of ["7", "7:5", "24:00", "12:60", "aa:bb", ""]) expect(normalizarHora(h)).toBeNull();
  });
});

describe("motivoTurnoInvalido", () => {
  it("acepta un turno normal y uno nocturno que cruza la medianoche", () => {
    expect(motivoTurnoInvalido({ nombre: "Mañana", horaInicio: "07:00", horaFin: "15:00" })).toBeNull();
    expect(motivoTurnoInvalido({ nombre: "Noche", horaInicio: "22:00", horaFin: "06:00" })).toBeNull();
  });

  it("exige nombre, horas válidas y que inicio y fin sean distintos", () => {
    expect(motivoTurnoInvalido({ nombre: " ", horaInicio: "07:00", horaFin: "15:00" })).not.toBeNull();
    expect(motivoTurnoInvalido({ nombre: "Mañana", horaInicio: "7", horaFin: "15:00" })).not.toBeNull();
    expect(motivoTurnoInvalido({ nombre: "Mañana", horaInicio: "7:00", horaFin: "07:00" })).not.toBeNull();
  });
});

it("textoTurno muestra nombre y horario", () => {
  expect(textoTurno({ id: "1", nombre: "Tarde", horaInicio: "15:00", horaFin: "23:00" })).toBe("Tarde · 15:00–23:00");
});
