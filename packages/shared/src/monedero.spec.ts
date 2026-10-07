import { calcularUsoMonedero, inicioPeriodoMonedero, saldoMonedero } from "./monedero";

// Fechas con el constructor LOCAL (año, mes, día, hora): las pruebas no dependen de la zona del equipo.
const viernes9pm = { diaSemana: 5, hora: 21 };
const sabado5pm = { diaSemana: 6, hora: 17 };

describe("inicioPeriodoMonedero", () => {
  it("el miércoles 7-oct-2026 el último reinicio fue el viernes anterior a las 9 PM", () => {
    expect(inicioPeriodoMonedero(new Date(2026, 9, 7, 13, 0), viernes9pm)).toEqual(new Date(2026, 9, 2, 21, 0));
  });

  it("el viernes antes de las 9 PM sigue en el periodo de la semana anterior", () => {
    expect(inicioPeriodoMonedero(new Date(2026, 9, 9, 20, 59), viernes9pm)).toEqual(new Date(2026, 9, 2, 21, 0));
  });

  it("el viernes a las 9 PM en punto ya es periodo nuevo", () => {
    expect(inicioPeriodoMonedero(new Date(2026, 9, 9, 21, 0), viernes9pm)).toEqual(new Date(2026, 9, 9, 21, 0));
  });

  it("el sábado antes de las 5 PM aún cuenta desde el sábado anterior", () => {
    expect(inicioPeriodoMonedero(new Date(2026, 9, 10, 16, 59), sabado5pm)).toEqual(new Date(2026, 9, 3, 17, 0));
  });

  it("cruza el fin de mes", () => {
    expect(inicioPeriodoMonedero(new Date(2026, 10, 2, 9, 0), viernes9pm)).toEqual(new Date(2026, 9, 30, 21, 0));
  });
});

describe("saldoMonedero", () => {
  const inicio = new Date(2026, 9, 2, 21, 0);

  it("descuenta solo lo consumido dentro del periodo", () => {
    const consumos = [
      { monto: 300, fecha: new Date(2026, 9, 2, 20, 0) }, // antes del reinicio: no cuenta
      { monto: 120, fecha: new Date(2026, 9, 3, 10, 0) },
      { monto: 80.5, fecha: new Date(2026, 9, 6, 9, 0).toISOString() },
    ];
    expect(saldoMonedero(500, consumos, inicio)).toBe(299.5);
  });

  it("nunca baja de cero", () => {
    expect(saldoMonedero(500, [{ monto: 700, fecha: new Date(2026, 9, 5) }], inicio)).toBe(0);
  });
});

describe("calcularUsoMonedero", () => {
  it("el saldo alcanza: todo va al monedero", () => {
    expect(calcularUsoMonedero(180, 500)).toEqual({ montoMonedero: 180, restante: 0 });
  });

  it("el saldo no alcanza: se usa todo y el resto se cobra con otro método", () => {
    expect(calcularUsoMonedero(180, 100)).toEqual({ montoMonedero: 100, restante: 80 });
  });

  it("sin saldo no cubre nada", () => {
    expect(calcularUsoMonedero(50, 0)).toEqual({ montoMonedero: 0, restante: 50 });
  });
});
