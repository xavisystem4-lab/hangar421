import { EstadoPedido } from "@hangar421/shared";
import { armarResumen, hoyEnZona, limiteDelDia, normalizarPaginacion } from "./ventas-consulta";

const MX = "America/Mexico_City";

describe("limiteDelDia", () => {
  it("el día empieza a las 00:00 de México, no a las 00:00 UTC", () => {
    // México va 6 horas por detrás de UTC en horario estándar: las 00:00 del 20 en México son
    // las 06:00 UTC del 20.
    expect(limiteDelDia("2026-09-20", MX, "inicio").toISOString()).toBe("2026-09-20T06:00:00.000Z");
  });

  it("el día termina a las 23:59:59.999 de México", () => {
    expect(limiteDelDia("2026-09-20", MX, "fin").toISOString()).toBe("2026-09-21T05:59:59.999Z");
  });

  it("una venta de las 20:00 de México cae DENTRO de su propio día", () => {
    // Es el error que hacía desaparecer las ventas de la tarde-noche: con el corte en UTC,
    // las 20:00 del 20 en México (02:00 UTC del 21) quedaban fuera del "día 20".
    const venta = new Date("2026-09-21T02:00:00.000Z"); // 20:00 del 20 en México
    expect(venta >= limiteDelDia("2026-09-20", MX, "inicio")).toBe(true);
    expect(venta <= limiteDelDia("2026-09-20", MX, "fin")).toBe(true);
  });

  it("una venta de las 20:00 de México NO cae en el día siguiente", () => {
    const venta = new Date("2026-09-21T02:00:00.000Z");
    expect(venta >= limiteDelDia("2026-09-21", MX, "inicio")).toBe(false);
  });

  it("respeta el horario de verano de otras zonas", () => {
    // Madrid en septiembre está en UTC+2 (verano), no en UTC+1.
    expect(limiteDelDia("2026-09-20", "Europe/Madrid", "inicio").toISOString()).toBe("2026-09-19T22:00:00.000Z");
    // Y en enero, en UTC+1.
    expect(limiteDelDia("2026-01-20", "Europe/Madrid", "inicio").toISOString()).toBe("2026-01-19T23:00:00.000Z");
  });

  it("rechaza una fecha con formato inválido", () => {
    expect(() => limiteDelDia("20-09-2026", MX, "inicio")).toThrow(/Fecha inválida/);
  });
});

describe("hoyEnZona", () => {
  it("a las 02:00 UTC todavía es el día anterior en México", () => {
    expect(hoyEnZona(MX, new Date("2026-09-21T02:00:00.000Z"))).toBe("2026-09-20");
  });

  it("a las 18:00 UTC ya es el mismo día en México", () => {
    expect(hoyEnZona(MX, new Date("2026-09-20T18:00:00.000Z"))).toBe("2026-09-20");
  });
});

describe("normalizarPaginacion", () => {
  it("usa 50 por defecto", () => {
    expect(normalizarPaginacion()).toEqual({ take: 50, skip: 0 });
  });

  it("topa el tamaño de página para que nadie pueda pedir la tabla entera", () => {
    expect(normalizarPaginacion(99999).take).toBe(200);
  });

  it("nunca devuelve valores negativos ni cero", () => {
    expect(normalizarPaginacion(0, -5)).toEqual({ take: 50, skip: 0 });
    expect(normalizarPaginacion(-3, -1)).toEqual({ take: 50, skip: 0 });
  });
});

describe("armarResumen", () => {
  it("solo suma al total las ventas COBRADAS", () => {
    const resumen = armarResumen([
      { estado: EstadoPedido.COBRADO, total: 100 },
      { estado: EstadoPedido.COBRADO, total: 50 },
      { estado: EstadoPedido.CANCELADO, total: 80 },
      { estado: EstadoPedido.ABIERTO, total: 40 },
    ]);
    expect(resumen.totalVendido).toBe(150);
    expect(resumen.numTickets).toBe(2);
    expect(resumen.ticketPromedio).toBe(75);
  });

  it("cuenta los tickets de cada estado, incluidos los no cobrados", () => {
    // Es lo que permite ver que una venta llegó al ERP a medias: el pedido entró pero su pago
    // no, así que se quedó en ABIERTO y no aparecería en ningún total.
    const resumen = armarResumen([
      { estado: EstadoPedido.COBRADO, total: 100 },
      { estado: EstadoPedido.ABIERTO, total: 40 },
      { estado: EstadoPedido.ABIERTO, total: 60 },
    ]);
    const abiertos = resumen.porEstado.find((e) => e.estado === EstadoPedido.ABIERTO);
    expect(abiertos).toEqual({ estado: EstadoPedido.ABIERTO, cantidad: 2, total: 100 });
  });

  it("no divide entre cero cuando no hay ventas cobradas", () => {
    const resumen = armarResumen([{ estado: EstadoPedido.CANCELADO, total: 80 }]);
    expect(resumen.totalVendido).toBe(0);
    expect(resumen.ticketPromedio).toBe(0);
  });

  it("devuelve ceros con una lista vacía", () => {
    expect(armarResumen([])).toEqual({ totalVendido: 0, numTickets: 0, ticketPromedio: 0, porEstado: [] });
  });

  it("redondea a dos decimales en vez de arrastrar el error del flotante", () => {
    const resumen = armarResumen([
      { estado: EstadoPedido.COBRADO, total: 0.1 },
      { estado: EstadoPedido.COBRADO, total: 0.2 },
    ]);
    expect(resumen.totalVendido).toBe(0.3);
  });
});
