import { CONFIG_COMISION_DIDI_POR_OMISION } from "@hangar421/shared";
import { armarReporteDidi, diaEnZona } from "./reporte-didi";

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
    expect(r.resumen).toMatchObject({ tickets: 2, bruto: 210, descuento: 33, pagadoCliente: 177 });
    expect(r.resumen.neto).toBeCloseTo(77 * 0.5615 + 65.2, 0);
    expect(r.porTipoPago.map((t) => t.tipo).sort()).toEqual(["EFECTIVO", "EN_LINEA"]);
    expect(r.porProducto[0].nombre).toBe("Cortado");
    expect(r.resumen.porcentajeNeto).toBeGreaterThan(55);
  });

  it("agrupa por día en la zona de la sucursal, no en UTC", () => {
    // 01:30 UTC del 24 = 19:30 del 23 en Ciudad de México.
    const r = armarReporteDidi([pedido({ fecha: new Date("2026-10-24T01:30:00Z") })], {}, CONFIG_COMISION_DIDI_POR_OMISION, MX);
    expect(r.porDia.map((d) => d.dia)).toEqual(["2026-10-23"]);
    expect(diaEnZona(new Date("2026-10-24T01:30:00Z"), "UTC")).toBe("2026-10-24");
  });

  it("aplica el subsidio de DiDi capturado por producto", () => {
    const r = armarReporteDidi(
      [pedido({ subtotal: 49, total: 49, pagos: [{ metodo: "EN_LINEA", monto: 49 }], items: [{ productoId: "latte", nombre: "Latte", cantidad: 1, importe: 49 }] })],
      { latte: 50 },
      CONFIG_COMISION_DIDI_POR_OMISION,
      MX,
    );
    expect(r.resumen.subsidio).toBe(50);
    expect(Math.round(r.resumen.neto)).toBe(56);
    expect(r.porProducto[0]).toMatchObject({ unidades: 1, subsidio: 50 });
  });

  it("sin ventas devuelve todo en cero", () => {
    const r = armarReporteDidi([], {}, CONFIG_COMISION_DIDI_POR_OMISION, MX);
    expect(r.resumen).toMatchObject({ tickets: 0, neto: 0, porcentajeNeto: 0 });
    expect(r.tickets).toEqual([]);
  });
});
