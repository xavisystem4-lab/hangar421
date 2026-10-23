import { esPagoEnLineaPlataforma, netoPedidoPlataforma, netoPlataforma, porcentajeComision, type ConfigComisionPlataforma, type NetoPedidoPlataforma } from "@hangar421/shared";

/**
 * Armado PURO del reporte "DiDi" del ERP (sin Prisma, para probarlo): lo vendido por la
 * plataforma y cuánto le queda de verdad al negocio después de la comisión, por día, por
 * producto, por tipo de pago y ticket por ticket. El cálculo del neto vive en
 * @hangar421/shared (`netoPedidoPlataforma`).
 */

export interface PedidoDidiFila {
  id: string;
  folio: string;
  fecha: Date;
  sucursal: string;
  subtotal: number;
  total: number;
  pagos: { metodo: string; monto: number }[];
  items: { productoId: string; nombre: string; cantidad: number; importe: number }[];
}

interface Totales {
  tickets: number;
  bruto: number;
  descuento: number;
  pagadoCliente: number;
  subsidio: number;
  comision: number;
  neto: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const vacio = (): Totales => ({ tickets: 0, bruto: 0, descuento: 0, pagadoCliente: 0, subsidio: 0, comision: 0, neto: 0 });

function sumar(t: Totales, n: NetoPedidoPlataforma) {
  t.tickets += 1;
  t.bruto += n.bruto;
  t.descuento += n.descuento;
  t.pagadoCliente += n.pagadoCliente;
  t.subsidio += n.subsidio;
  t.comision += n.comision;
  t.neto += n.neto;
}

function redondear<T extends Totales>(t: T): T & { porcentajeNeto: number } {
  const r = { ...t } as T & { porcentajeNeto: number };
  for (const k of ["bruto", "descuento", "pagadoCliente", "subsidio", "comision", "neto"] as const) r[k] = r2(t[k]);
  // Qué parte de lo que pagó el cliente (más subsidio) termina siendo del negocio.
  const base = t.pagadoCliente + t.subsidio;
  r.porcentajeNeto = base > 0 ? r2((t.neto / base) * 100) : 0;
  return r;
}

/** "2026-10-23" del instante en la zona de la sucursal. */
export function diaEnZona(fecha: Date, zona: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" }).format(fecha);
}

/** Hora del día (0–23) del instante en la zona de la sucursal. */
export function horaEnZona(fecha: Date, zona: string): number {
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: zona, hour: "numeric", hourCycle: "h23" }).format(fecha));
  return Number.isFinite(h) ? h % 24 : 0;
}

export function armarReporteDidi(pedidos: PedidoDidiFila[], subsidios: Record<string, number>, config: ConfigComisionPlataforma, zona: string) {
  const resumen = vacio();
  const porTipo = new Map<string, Totales>();
  const porDia = new Map<string, Totales>();
  const porHora = new Map<number, Totales>();
  // Por método de pago REAL (pagado en la app, tarjeta, efectivo, dólares…): cada pago con su
  // parte del ticket y del subsidio, y la comisión que le toca a ese método.
  const porMetodo = new Map<string, { metodo: string; enLinea: boolean; transacciones: number; pagadoCliente: number; subsidio: number; comision: number; neto: number }>();
  const porProducto = new Map<string, { productoId: string; nombre: string; unidades: number; bruto: number; pagadoCliente: number; subsidio: number; neto: number }>();
  const tickets = [];

  for (const p of pedidos) {
    const n = netoPedidoPlataforma({ total: p.total, subtotal: p.subtotal, pagos: p.pagos, items: p.items }, subsidios, config);
    sumar(resumen, n);
    const tipo = porTipo.get(n.tipoPago) ?? vacio();
    sumar(tipo, n);
    porTipo.set(n.tipoPago, tipo);
    const dia = diaEnZona(p.fecha, zona);
    const d = porDia.get(dia) ?? vacio();
    sumar(d, n);
    porDia.set(dia, d);
    const hora = horaEnZona(p.fecha, zona);
    const h = porHora.get(hora) ?? vacio();
    sumar(h, n);
    porHora.set(hora, h);
    const pagos = p.pagos.filter((x) => (Number(x.monto) || 0) > 0);
    const sumaPagos = pagos.reduce((s, x) => s + Number(x.monto), 0);
    for (const x of pagos.length ? pagos : [{ metodo: "EN_LINEA", monto: n.pagadoCliente }]) {
      const fraccion = sumaPagos > 0 ? Number(x.monto) / sumaPagos : 1;
      const enLinea = esPagoEnLineaPlataforma(x.metodo);
      const parte = netoPlataforma({ pagadoCliente: n.pagadoCliente * fraccion, subsidio: n.subsidio * fraccion, enLinea }, config);
      const g = porMetodo.get(x.metodo) ?? { metodo: x.metodo, enLinea, transacciones: 0, pagadoCliente: 0, subsidio: 0, comision: 0, neto: 0 };
      g.transacciones += 1;
      g.pagadoCliente += n.pagadoCliente * fraccion;
      g.subsidio += n.subsidio * fraccion;
      g.comision += parte.comision;
      g.neto += parte.neto;
      porMetodo.set(x.metodo, g);
    }
    for (const l of n.porProducto) {
      const g = porProducto.get(l.productoId) ?? { productoId: l.productoId, nombre: l.nombre, unidades: 0, bruto: 0, pagadoCliente: 0, subsidio: 0, neto: 0 };
      g.unidades += l.cantidad;
      g.bruto += l.bruto;
      g.pagadoCliente += l.pagadoCliente;
      g.subsidio += l.subsidio;
      g.neto += l.neto;
      porProducto.set(l.productoId, g);
    }
    tickets.push({
      id: p.id,
      folio: p.folio,
      fecha: p.fecha.toISOString(),
      sucursal: p.sucursal,
      tipoPago: n.tipoPago,
      metodos: [...new Set(p.pagos.map((x) => x.metodo))],
      bruto: n.bruto,
      descuento: n.descuento,
      pagadoCliente: n.pagadoCliente,
      subsidio: n.subsidio,
      comision: n.comision,
      neto: n.neto,
      productos: p.items.map((i) => `${i.cantidad}× ${i.nombre}`).join(", "),
      // Detalle para desplegar el pedido en el ERP: qué se vendió y por cuánto.
      items: p.items.map((i) => ({ productoId: i.productoId, nombre: i.nombre, cantidad: i.cantidad, importe: r2(i.importe) })),
      pagos: p.pagos.map((x) => ({ metodo: x.metodo, monto: r2(Number(x.monto) || 0) })),
    });
  }

  return {
    config,
    resumen: redondear(resumen),
    porTipoPago: [...porTipo.entries()].map(([tipo, t]) => ({ tipo, ...redondear(t) })).sort((a, b) => b.pagadoCliente - a.pagadoCliente),
    porDia: [...porDia.entries()].map(([dia, t]) => ({ dia, ...redondear(t) })).sort((a, b) => a.dia.localeCompare(b.dia)),
    // Solo las horas con pedidos, de la más temprana a la más tarde: para ver la hora pico.
    porMetodo: [...porMetodo.values()]
      .map((g) => ({
        ...g,
        comisionPct: porcentajeComision(g.enLinea, config),
        pagadoCliente: r2(g.pagadoCliente),
        subsidio: r2(g.subsidio),
        comision: r2(g.comision),
        neto: r2(g.neto),
      }))
      .sort((a, b) => b.pagadoCliente - a.pagadoCliente),
    porHora: [...porHora.entries()].map(([hora, t]) => ({ hora, ...redondear(t) })).sort((a, b) => a.hora - b.hora),
    porProducto: [...porProducto.values()]
      .map((g) => ({ ...g, bruto: r2(g.bruto), pagadoCliente: r2(g.pagadoCliente), subsidio: r2(g.subsidio), neto: r2(g.neto), netoPorUnidad: g.unidades > 0 ? r2(g.neto / g.unidades) : 0 }))
      .sort((a, b) => b.neto - a.neto),
    tickets: tickets.sort((a, b) => b.fecha.localeCompare(a.fecha)),
  };
}
