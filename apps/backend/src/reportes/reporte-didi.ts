import { netoPedidoPlataforma, type ConfigComisionPlataforma, type NetoPedidoPlataforma } from "@hangar421/shared";

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
  retencion: number;
  neto: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const vacio = (): Totales => ({ tickets: 0, bruto: 0, descuento: 0, pagadoCliente: 0, subsidio: 0, comision: 0, retencion: 0, neto: 0 });

function sumar(t: Totales, n: NetoPedidoPlataforma) {
  t.tickets += 1;
  t.bruto += n.bruto;
  t.descuento += n.descuento;
  t.pagadoCliente += n.pagadoCliente;
  t.subsidio += n.subsidio;
  t.comision += n.comision;
  t.retencion += n.retencion;
  t.neto += n.neto;
}

function redondear<T extends Totales>(t: T): T & { porcentajeNeto: number } {
  const r = { ...t } as T & { porcentajeNeto: number };
  for (const k of ["bruto", "descuento", "pagadoCliente", "subsidio", "comision", "retencion", "neto"] as const) r[k] = r2(t[k]);
  // Qué parte de lo que pagó el cliente (más subsidio) termina siendo del negocio.
  const base = t.pagadoCliente + t.subsidio;
  r.porcentajeNeto = base > 0 ? r2((t.neto / base) * 100) : 0;
  return r;
}

/** "2026-10-23" del instante en la zona de la sucursal. */
export function diaEnZona(fecha: Date, zona: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" }).format(fecha);
}

export function armarReporteDidi(pedidos: PedidoDidiFila[], subsidios: Record<string, number>, config: ConfigComisionPlataforma, zona: string) {
  const resumen = vacio();
  const porTipo = new Map<string, Totales>();
  const porDia = new Map<string, Totales>();
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
      bruto: n.bruto,
      descuento: n.descuento,
      pagadoCliente: n.pagadoCliente,
      subsidio: n.subsidio,
      comision: n.comision,
      retencion: n.retencion,
      neto: n.neto,
      productos: p.items.map((i) => `${i.cantidad}× ${i.nombre}`).join(", "),
    });
  }

  return {
    config,
    resumen: redondear(resumen),
    porTipoPago: [...porTipo.entries()].map(([tipo, t]) => ({ tipo, ...redondear(t) })).sort((a, b) => b.pagadoCliente - a.pagadoCliente),
    porDia: [...porDia.entries()].map(([dia, t]) => ({ dia, ...redondear(t) })).sort((a, b) => a.dia.localeCompare(b.dia)),
    porProducto: [...porProducto.values()]
      .map((g) => ({ ...g, bruto: r2(g.bruto), pagadoCliente: r2(g.pagadoCliente), subsidio: r2(g.subsidio), neto: r2(g.neto), netoPorUnidad: g.unidades > 0 ? r2(g.neto / g.unidades) : 0 }))
      .sort((a, b) => b.neto - a.neto),
    tickets: tickets.sort((a, b) => b.fecha.localeCompare(a.fecha)),
  };
}
