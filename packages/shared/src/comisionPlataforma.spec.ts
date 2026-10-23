import { netoPedidoPlataforma, netoPlataforma, porcentajeComision } from "./comisionPlataforma";

describe("netoPlataforma — 43 % con tarjeta / 35 % en efectivo", () => {
  it("pagado con tarjeta o en la app: DiDi se queda el 43 % del total", () => {
    expect(netoPlataforma({ pagadoCliente: 100, enLinea: true })).toEqual({ base: 100, comision: 43, neto: 57 });
    expect(netoPlataforma({ pagadoCliente: 110, enLinea: true })).toEqual({ base: 110, comision: 47.3, neto: 62.7 });
  });

  it("pagado en efectivo: DiDi se queda el 35 % del total", () => {
    expect(netoPlataforma({ pagadoCliente: 100, enLinea: false })).toEqual({ base: 100, comision: 35, neto: 65 });
    expect(netoPlataforma({ pagadoCliente: 77, enLinea: false })).toEqual({ base: 77, comision: 26.95, neto: 50.05 });
  });

  it("el subsidio de DiDi suma a la base", () => {
    expect(netoPlataforma({ pagadoCliente: 50, subsidio: 50, enLinea: true })).toEqual({ base: 100, comision: 43, neto: 57 });
  });

  it("respeta porcentajes configurados", () => {
    const cfg = { comisionEnLineaPct: 40, comisionEfectivoPct: 30 };
    expect(netoPlataforma({ pagadoCliente: 100, enLinea: true }, cfg).neto).toBe(60);
    expect(netoPlataforma({ pagadoCliente: 100, enLinea: false }, cfg).neto).toBe(70);
    expect(porcentajeComision(true, cfg)).toBe(40);
  });
});

describe("netoPedidoPlataforma", () => {
  const latteFrio = { productoId: "lf", nombre: "Latte Frío", cantidad: 1, importe: 110 };

  it("pedido pagado en la app con 30 % de promoción: 43 % sobre lo que pagó el cliente", () => {
    const r = netoPedidoPlataforma({ total: 77, subtotal: 110, pagos: [{ metodo: "EN_LINEA", monto: 77 }], items: [latteFrio] });
    expect(r).toMatchObject({ bruto: 110, descuento: 33, pagadoCliente: 77, subsidio: 0, comision: 33.11, neto: 43.89, tipoPago: "EN_LINEA" });
    expect(r.porProducto[0].neto).toBeCloseTo(r.neto, 1);
  });

  it("la tarjeta normal también cuenta como pago con tarjeta (43 %)", () => {
    expect(netoPedidoPlataforma({ total: 100, subtotal: 100, pagos: [{ metodo: "TARJETA", monto: 100 }], items: [] })).toMatchObject({ tipoPago: "EN_LINEA", neto: 57 });
  });

  it("efectivo y dólares cuentan como efectivo (35 %)", () => {
    expect(netoPedidoPlataforma({ total: 100, subtotal: 100, pagos: [{ metodo: "EFECTIVO", monto: 100 }], items: [] })).toMatchObject({ tipoPago: "EFECTIVO", comision: 35, neto: 65 });
    expect(netoPedidoPlataforma({ total: 100, subtotal: 100, pagos: [{ metodo: "EFECTIVO_USD", monto: 100 }], items: [] }).neto).toBe(65);
  });

  it("sin pagos registrados se asume pagado en la app", () => {
    expect(netoPedidoPlataforma({ total: 100, subtotal: 100, pagos: [], items: [] })).toMatchObject({ tipoPago: "EN_LINEA", neto: 57 });
  });

  it("suma el subsidio capturado por producto", () => {
    const r = netoPedidoPlataforma(
      { total: 49, subtotal: 49, pagos: [{ metodo: "EN_LINEA", monto: 49 }], items: [{ productoId: "latte", nombre: "Latte", cantidad: 1, importe: 49 }] },
      { latte: 50 },
    );
    expect(r).toMatchObject({ subsidio: 50, base: 99, comision: 42.57, neto: 56.43 });
  });

  it("un pago mixto se calcula por partes", () => {
    const r = netoPedidoPlataforma({ total: 200, subtotal: 200, pagos: [{ metodo: "EFECTIVO", monto: 100 }, { metodo: "EN_LINEA", monto: 100 }], items: [{ ...latteFrio, importe: 200 }] });
    expect(r).toMatchObject({ tipoPago: "MIXTO", comision: 78, neto: 122 });
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
