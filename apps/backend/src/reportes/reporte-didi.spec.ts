import { CONFIG_COMISION_DIDI_POR_OMISION } from "@hangar421/shared";
import { armarReporteDidi, diaEnZona, horaEnZona } from "./reporte-didi";

const MX = "America/Mexico_City";
const pedido = (extra: any) => ({
  id: "p", folio: "1", fecha: new Date("2026-10-23T18:00:00Z"), sucursal: "Benito Juárez",
  subtotal: 110, total: 77, pagos: [{ metodo: "EN_LINEA", monto: 77 }],
  items: [{ productoId: "lf", nombre: "Latte Frío", cantidad: 1, importe: 110 }],
  ...extra,
});

describe("armarReporteDidi", () => {
  it("suma ventas y neto, y separa pagado en la app de efectivo", () => {
    const r = armarReporteDidi(
      [pedido({ id: "a" }), pedido({ id: "b", subtotal: 100, total: 100, pagos: [{ metodo: "EFECTIVO", monto: 100 }], items: [{ productoId: "x", nombre: "Cortado", cantidad: 1, importe: 100 }] })],
      {},
      CONFIG_COMISION_DIDI_POR_OMISION,
      MX,
    );
    // App: 77 − 43 % = 43.89 · Efectivo: 100 − 35 % = 65
    expect(r.resumen).toMatchObject({ tickets: 2, bruto: 210, descuento: 33, pagadoCliente: 177, comision: 68.11, neto: 108.89 });
    expect(r.porTipoPago.find((t) => t.tipo === "EN_LINEA")).toMatchObject({ comision: 33.11, neto: 43.89, porcentajeNeto: 57 });
    expect(r.porTipoPago.find((t) => t.tipo === "EFECTIVO")).toMatchObject({ comision: 35, neto: 65, porcentajeNeto: 65 });
    expect(r.porProducto[0].nombre).toBe("Cortado");
    expect(r.porMetodo).toEqual([
      { metodo: "EFECTIVO", enLinea: false, transacciones: 1, pagadoCliente: 100, subsidio: 0, comision: 35, neto: 65, comisionPct: 35 },
      { metodo: "EN_LINEA", enLinea: true, transacciones: 1, pagadoCliente: 77, subsidio: 0, comision: 33.11, neto: 43.89, comisionPct: 43 },
    ]);
    expect(r.tickets.find((t) => t.id === "b")?.metodos).toEqual(["EFECTIVO"]);
  });

  it("separa tarjeta del POS de pagado en la app y reparte un pago mixto", () => {
    const r = armarReporteDidi(
      [
        pedido({ id: "t", total: 100, subtotal: 100, pagos: [{ metodo: "TARJETA", monto: 100 }] }),
        pedido({ id: "m", total: 200, subtotal: 200, pagos: [{ metodo: "EFECTIVO", monto: 120 }, { metodo: "EN_LINEA", monto: 80 }] }),
      ],
      {},
      CONFIG_COMISION_DIDI_POR_OMISION,
      MX,
    );
    const m = Object.fromEntries(r.porMetodo.map((x) => [x.metodo, x]));
    expect(m.TARJETA).toMatchObject({ transacciones: 1, pagadoCliente: 100, comision: 43, neto: 57 });
    expect(m.EFECTIVO).toMatchObject({ transacciones: 1, pagadoCliente: 120, comision: 42, neto: 78 });
    expect(m.EN_LINEA).toMatchObject({ transacciones: 1, pagadoCliente: 80, comision: 34.4, neto: 45.6 });
    expect(r.porMetodo.reduce((s, x) => s + x.neto, 0)).toBeCloseTo(r.resumen.neto, 1);
  });

  it("agrupa por día en la zona de la sucursal, no en UTC", () => {
    // 01:30 UTC del 24 = 19:30 del 23 en Ciudad de México.
    const r = armarReporteDidi([pedido({ fecha: new Date("2026-10-24T01:30:00Z") })], {}, CONFIG_COMISION_DIDI_POR_OMISION, MX);
    expect(r.porDia.map((d) => d.dia)).toEqual(["2026-10-23"]);
    expect(diaEnZona(new Date("2026-10-24T01:30:00Z"), "UTC")).toBe("2026-10-24");
  });

  it("agrupa por hora del día en la zona de la sucursal", () => {
    const r = armarReporteDidi(
      [
        pedido({ id: "a", fecha: new Date("2026-10-23T19:10:00Z") }), // 13:10 en CDMX
        pedido({ id: "b", fecha: new Date("2026-10-23T19:50:00Z") }), // 13:50
        pedido({ id: "c", fecha: new Date("2026-10-24T01:30:00Z") }), // 19:30 del 23
      ],
      {},
      CONFIG_COMISION_DIDI_POR_OMISION,
      MX,
    );
    expect(r.porHora.map((h) => [h.hora, h.tickets])).toEqual([[13, 2], [19, 1]]);
    expect(horaEnZona(new Date("2026-10-23T06:05:00Z"), MX)).toBe(0);
  });

  it("aplica el subsidio de DiDi capturado por producto", () => {
    const r = armarReporteDidi(
      [pedido({ subtotal: 49, total: 49, pagos: [{ metodo: "EN_LINEA", monto: 49 }], items: [{ productoId: "latte", nombre: "Latte", cantidad: 1, importe: 49 }] })],
      { latte: 50 },
      CONFIG_COMISION_DIDI_POR_OMISION,
      MX,
    );
    expect(r.resumen.subsidio).toBe(50);
    expect(r.resumen.neto).toBe(56.43); // (49 + 50) − 43 %
    expect(r.porProducto[0]).toMatchObject({ unidades: 1, subsidio: 50 });
  });

  it("sin ventas devuelve todo en cero", () => {
    const r = armarReporteDidi([], {}, CONFIG_COMISION_DIDI_POR_OMISION, MX);
    expect(r.resumen).toMatchObject({ tickets: 0, neto: 0, porcentajeNeto: 0 });
    expect(r.tickets).toEqual([]);
  });
});
