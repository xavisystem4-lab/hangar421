import { armarCorteDetallado, textoCorte, type DatosCorte } from "./corteDetallado";
import { construirDesglose } from "./denominaciones";

const BASE: DatosCorte = {
  sucursal: "Benito Juárez",
  cajero: "Dalia Franco",
  abiertoAt: "2026-10-10T13:00:00.000Z",
  cortadoAt: "2026-10-10T22:00:00.000Z",
  cerrado: false,
  montoInicial: 500,
  tipoCambioUsd: 18.5,
  porOrigen: [
    { origen: "DIDI", total: 300, cantidad: 2, porMetodo: [{ metodo: "EN_LINEA", total: 300, cantidad: 2 }] },
    {
      origen: "MOSTRADOR", total: 1200, cantidad: 10,
      porMetodo: [{ metodo: "TARJETA", total: 400, cantidad: 3 }, { metodo: "EFECTIVO", total: 800, cantidad: 7 }],
    },
  ],
  movimientos: [
    { tipo: "INGRESO", monto: 100, motivo: "Cambio" },
    { tipo: "EGRESO", monto: 60, motivo: "Hielo" },
    { tipo: "EGRESO", monto: 40, motivo: "Leche" },
  ],
  ventasEnEfectivo: { mxn: 800, usd: 0 },
  desglose: construirDesglose({ 500: 2, 100: 3 }, { 10: 2, 0.5: 1 }, {}, "Todo bien"),
  descuentos: [{ folio: 12, motivo: "Cliente frecuente", valor: 10, tipo: "PORCENTAJE" }],
  canceladas: 1,
  etiquetaMetodo: (m) => ({ EFECTIVO: "Efectivo", TARJETA: "Tarjeta", EN_LINEA: "Pagado en línea" })[m] ?? m,
  etiquetaOrigen: (o) => ({ MOSTRADOR: "Mostrador", DIDI: "DiDi Food" })[o] ?? o,
};

describe("armarCorteDetallado", () => {
  const c = armarCorteDetallado(BASE);

  it("el fondo va aparte y NO se suma a las ventas", () => {
    expect(c.fondo).toBe(500);
    expect(c.ventas.total).toBe(1500);
    expect(c.ventas.tickets).toBe(12);
  });

  it("separa mostrador de plataformas y ordena mostrador primero", () => {
    expect(c.ventas.mostrador).toBe(1200);
    expect(c.ventas.plataformas).toBe(300);
    expect(c.ventas.porOrigen.map((o) => o.etiqueta)).toEqual(["Mostrador", "DiDi Food"]);
  });

  it("suma los métodos de pago de todos los orígenes, efectivo primero", () => {
    expect(c.ventas.porMetodo).toEqual([
      { metodo: "EFECTIVO", etiqueta: "Efectivo", total: 800, cantidad: 7 },
      { metodo: "TARJETA", etiqueta: "Tarjeta", total: 400, cantidad: 3 },
      { metodo: "EN_LINEA", etiqueta: "Pagado en línea", total: 300, cantidad: 2 },
    ]);
  });

  it("ingresos y egresos con sus totales", () => {
    expect(c.ingresos.total).toBe(100);
    expect(c.egresos.total).toBe(100);
    expect(c.egresos.lineas.map((m) => m.motivo)).toEqual(["Hielo", "Leche"]);
  });

  it("el efectivo esperado en cajón = fondo + ventas en efectivo + ingresos − egresos", () => {
    expect(c.efectivo).toEqual({ fondo: 500, ventasEfectivoMxn: 800, ingresos: 100, egresos: 100, esperado: 1300 });
  });

  it("el conteo por denominación lleva piezas y subtotal, y la diferencia contra lo esperado", () => {
    expect(c.conteo.billetes).toEqual([
      { denominacion: 500, piezas: 2, subtotal: 1000 },
      { denominacion: 100, piezas: 3, subtotal: 300 },
    ]);
    expect(c.conteo.monedas).toEqual([
      { denominacion: 10, piezas: 2, subtotal: 20 },
      { denominacion: 0.5, piezas: 1, subtotal: 0.5 },
    ]);
    expect(c.conteo.totalMXN).toBe(1320.5);
    expect(c.resultado).toMatchObject({ contado: 1320.5, esperado: 1300, diferencia: 20.5 });
  });

  it("conserva descuentos, canceladas y observaciones", () => {
    expect(c.descuentos).toHaveLength(1);
    expect(c.canceladas).toBe(1);
    expect(c.observaciones).toBe("Todo bien");
  });
});

describe("textoCorte", () => {
  it("arma un texto legible con las secciones en orden: fondo, ventas, plataformas, ingresos, egresos, cajón, conteo, resultado", () => {
    const t = textoCorte(armarCorteDetallado(BASE));
    const pos = (s: string) => t.indexOf(s);
    expect(pos("FONDO DE CAJA (no es venta): $500.00")).toBeGreaterThan(-1);
    expect(pos("FONDO DE CAJA")).toBeLessThan(pos("VENTAS DEL TURNO: $1500.00 (12 tickets)"));
    expect(pos("VENTAS DEL TURNO")).toBeLessThan(pos("DiDi Food: $300.00 (2)"));
    expect(pos("INGRESOS: $100.00")).toBeLessThan(pos("EGRESOS: $100.00"));
    expect(pos("EGRESOS")).toBeLessThan(pos("EFECTIVO QUE DEBE HABER EN CAJÓN"));
    expect(t).toContain("= $1300.00");
    expect(t).toContain("Billete $500.00 × 2 = $1000.00");
    expect(t).toContain("DIFERENCIA: SOBRAN $20.50");
    expect(t).toContain("Observaciones: Todo bien");
  });

  it("dice CUADRA cuando contado = esperado", () => {
    const t = textoCorte(armarCorteDetallado({ ...BASE, desglose: construirDesglose({ 500: 2, 100: 3 }, {}, {}) }));
    expect(t).toContain("DIFERENCIA: CUADRA");
  });
});
