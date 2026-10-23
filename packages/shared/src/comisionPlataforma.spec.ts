import { netoPedidoPlataforma, netoPlataforma } from "./comisionPlataforma";

/** Valores tomados de la hoja de precios de DiDi de Hangar 421 ("monto a recibir aprox."). */
describe("netoPlataforma — reproduce la hoja de DiDi", () => {
  const casos: [string, number, number, number, number][] = [
    // producto, pagado por el cliente, subsidio DiDi, esperado efectivo, esperado tarjeta/app
    ["The Perfect Match", 150, 0, 98, 84],
    ["Órbita", 180, 0, 117, 101],
    ["Cortado", 98, 0, 64, 55],
    ["Latte Frío", 110, 0, 72, 62],
    ["Latte Maple y Sal (31 % desc.)", 97, 0, 63, 54],
    ["Blue Lover (50 % desc.)", 140, 0, 91, 79],
    ["Latte caliente (promo con subsidio)", 50, 50, 65, 56],
    ["Americano caliente (promo con subsidio)", 49, 27, 50, 43],
  ];
  it.each(casos)("%s", (_n, pagado, subsidio, efectivo, tarjeta) => {
    expect(Math.round(netoPlataforma({ pagadoCliente: pagado, subsidio, enLinea: false }).neto)).toBe(efectivo);
    expect(Math.round(netoPlataforma({ pagadoCliente: pagado, subsidio, enLinea: true }).neto)).toBe(tarjeta);
  });

  it("desglosa comisión con IVA y retención solo en pagos en línea", () => {
    expect(netoPlataforma({ pagadoCliente: 100, enLinea: false })).toEqual({ base: 100, comision: 34.8, retencion: 0, neto: 65.2 });
    expect(netoPlataforma({ pagadoCliente: 116, enLinea: true })).toEqual({ base: 116, comision: 40.37, retencion: 10.5, neto: 65.13 });
  });

  it("respeta una comisión distinta", () => {
    expect(netoPlataforma({ pagadoCliente: 100, enLinea: false }, { comisionPct: 25, ivaComisionPct: 16, retencionPct: 0, ivaVentaPct: 16 }).neto).toBe(71);
  });
});

describe("netoPedidoPlataforma", () => {
  const latteFrio = { productoId: "lf", nombre: "Latte Frío", cantidad: 1, importe: 110 };

  it("pedido pagado en la app con 30 % de promoción", () => {
    const r = netoPedidoPlataforma({ total: 77, subtotal: 110, pagos: [{ metodo: "EN_LINEA", monto: 77 }], items: [latteFrio] });
    expect(r).toMatchObject({ bruto: 110, descuento: 33, pagadoCliente: 77, subsidio: 0, tipoPago: "EN_LINEA" });
    expect(r.neto).toBeCloseTo(77 * 0.5615, 0);
    expect(r.porProducto[0].neto).toBeCloseTo(r.neto, 1);
  });

  it("suma el subsidio capturado por producto", () => {
    const r = netoPedidoPlataforma(
      { total: 49, subtotal: 49, pagos: [{ metodo: "EN_LINEA", monto: 49 }], items: [{ productoId: "latte", nombre: "Latte", cantidad: 1, importe: 49 }] },
      { latte: 50 },
    );
    expect(r.subsidio).toBe(50);
    expect(r.base).toBe(99);
    expect(Math.round(r.neto)).toBe(56);
  });

  it("un pago mixto se calcula por partes", () => {
    const r = netoPedidoPlataforma({ total: 200, subtotal: 200, pagos: [{ metodo: "EFECTIVO", monto: 100 }, { metodo: "EN_LINEA", monto: 100 }], items: [{ ...latteFrio, importe: 200 }] });
    expect(r.tipoPago).toBe("MIXTO");
    expect(r.neto).toBeCloseTo(65.2 + netoPlataforma({ pagadoCliente: 100, enLinea: true }).neto, 1);
  });

  it("efectivo no lleva retención; sin pagos se asume pagado en la app", () => {
    expect(netoPedidoPlataforma({ total: 100, subtotal: 100, pagos: [{ metodo: "EFECTIVO", monto: 100 }], items: [] })).toMatchObject({ tipoPago: "EFECTIVO", retencion: 0, neto: 65.2 });
    expect(netoPedidoPlataforma({ total: 100, subtotal: 100, pagos: [], items: [] }).tipoPago).toBe("EN_LINEA");
  });

  it("reparte el neto entre los productos del ticket", () => {
    const r = netoPedidoPlataforma({
      total: 260, subtotal: 260, pagos: [{ metodo: "EN_LINEA", monto: 260 }],
      items: [{ productoId: "m", nombre: "Matcha", cantidad: 1, importe: 150 }, latteFrio],
    });
    expect(r.porProducto.reduce((s, p) => s + p.neto, 0)).toBeCloseTo(r.neto, 1);
    expect(r.porProducto[0].neto).toBeGreaterThan(r.porProducto[1].neto);
  });
});
