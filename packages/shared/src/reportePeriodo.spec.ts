import { armarReportePeriodo, etiquetaHora, turnoDelDia } from "./reportePeriodo";

const ZONA = "America/Tijuana";
// Noviembre 2026: Tijuana en UTC-8.
const venta = (iso: string, total: number, sucursal: string, empleado: string, turnoApertura: string | null = null) => ({ fecha: iso, total, sucursal, empleado, turnoApertura });

describe("armarReportePeriodo", () => {
  const ventas = [
    venta("2026-11-02T16:30:00Z", 100, "Mecánicos", "Andrea", "2026-11-02T15:45:00Z"), // lun 08:30, turno 07:45 → mañana
    venta("2026-11-02T17:10:00Z", 50, "Mecánicos", "Andrea", "2026-11-02T15:45:00Z"), // lun 09:10
    venta("2026-11-03T00:30:00Z", 80, "Mecánicos", "Daniela", "2026-11-02T23:00:00Z"), // lun 16:30, turno 15:00 → tarde
    venta("2026-11-06T18:00:00Z", 200, "Benito Juárez", "Diana", "2026-11-06T14:00:00Z"), // vie 10:00, turno 06:00 → mañana
    venta("2026-11-07T06:30:00Z", 30, "Benito Juárez", "Dalia"), // vie 22:30 local (sáb en UTC), sin turno
  ];
  const r = armarReportePeriodo(ventas, ZONA);

  it("totales y ticket promedio", () => {
    expect(r.tickets).toBe(5);
    expect(r.total).toBe(460);
    expect(r.ticketPromedio).toBe(92);
  });

  it("por cafetería, de más a menos, con porcentaje", () => {
    expect(r.porSucursal.map((g) => [g.clave, g.tickets, g.total])).toEqual([
      ["Mecánicos", 3, 230],
      ["Benito Juárez", 2, 230],
    ]);
    expect(r.porSucursal[0].porcentaje).toBe(50);
  });

  it("por empleado con su cafetería", () => {
    expect(r.porEmpleado.map((g) => [g.empleado, g.sucursal, g.total])).toEqual([
      ["Diana", "Benito Juárez", 200],
      ["Andrea", "Mecánicos", 150],
      ["Daniela", "Mecánicos", 80],
      ["Dalia", "Benito Juárez", 30],
    ]);
    expect(r.mejor.empleado?.empleado).toBe("Diana");
  });

  it("días de la semana en la zona de la sucursal (la venta de las 22:30 es viernes, no sábado)", () => {
    const dias = Object.fromEntries(r.porDiaSemana.map((d) => [d.clave, d.total]));
    expect(dias).toEqual({ Lunes: 230, Martes: 0, Miércoles: 0, Jueves: 0, Viernes: 230, Sábado: 0, Domingo: 0 });
    expect(r.porDiaSemana.map((d) => d.clave)[0]).toBe("Lunes");
  });

  it("por hora, solo las que tienen ventas y en orden", () => {
    expect(r.porHora.map((h) => [h.hora, h.total])).toEqual([[8, 100], [9, 50], [10, 200], [16, 80], [22, 30]]);
    expect(r.mejor.hora?.hora).toBe(10);
  });

  it("por turno: mañana / tarde / sin turno por cafetería", () => {
    expect(r.porTurno.map((t) => [t.sucursal, t.turno, t.total])).toEqual([
      ["Benito Juárez", "Mañana", 200],
      ["Mecánicos", "Mañana", 150],
      ["Mecánicos", "Tarde", 80],
      ["Benito Juárez", "Sin turno", 30],
    ]);
  });

  it("por fecha local", () => {
    expect(r.porFecha.map((f) => [f.fecha, f.total])).toEqual([["2026-11-02", 230], ["2026-11-06", 230]]);
  });

  it("sin ventas", () => {
    const vacio = armarReportePeriodo([], ZONA);
    expect(vacio.total).toBe(0);
    expect(vacio.mejor.sucursal).toBeNull();
    expect(vacio.porDiaSemana).toHaveLength(7);
  });
});

describe("auxiliares", () => {
  it("turnoDelDia", () => {
    expect(turnoDelDia("2026-11-02T15:45:00Z", ZONA)).toBe("Mañana");
    expect(turnoDelDia("2026-11-02T23:00:00Z", ZONA)).toBe("Tarde");
    expect(turnoDelDia(null, ZONA)).toBe("Sin turno");
  });
  it("etiquetaHora", () => {
    expect(etiquetaHora(7)).toBe("07:00 – 08:00");
    expect(etiquetaHora(23)).toBe("23:00 – 00:00");
  });
});

describe("zona local", () => {
  it("usa los getters de Date del dispositivo", () => {
    const f = new Date(2026, 10, 6, 22, 30); // viernes 22:30 local
    const r = armarReportePeriodo([{ fecha: f, total: 10, sucursal: "S", empleado: "E" }], "local");
    expect(r.porHora[0].hora).toBe(22);
    expect(r.porDiaSemana.find((d) => d.total > 0)?.clave).toBe("Viernes");
    expect(r.porFecha[0].fecha).toBe("2026-11-06");
  });
});
