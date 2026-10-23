/**
 * Cuánto le queda al negocio de una venta por plataforma de reparto (DiDi Food), ya descontada la
 * comisión. Lo usan el reporte "DiDi" del ERP y quien quiera mostrar el neto de un pedido.
 *
 * Regla del negocio (Hangar 421): la comisión de DiDi es un porcentaje plano que se resta de la
 * cuenta total, y depende de cómo pagó el cliente:
 *
 *   pagado con tarjeta / en la app → 43 % para DiDi
 *   pagado en efectivo             → 35 % para DiDi
 *
 *   base     = lo que pagó el cliente + subsidio de DiDi (si la promoción lo tiene)
 *   comisión = base × % del tipo de pago
 *   neto     = base − comisión
 *
 * Los dos porcentajes se configuran en el ERP porque la comisión pactada puede cambiar.
 */

export interface ConfigComisionPlataforma {
  /** Comisión cuando el cliente paga con tarjeta o en la app, en % (43 = 43 %). */
  comisionEnLineaPct: number;
  /** Comisión cuando el cliente paga en efectivo, en %. */
  comisionEfectivoPct: number;
}

export const CONFIG_COMISION_DIDI_POR_OMISION: ConfigComisionPlataforma = {
  comisionEnLineaPct: 43,
  comisionEfectivoPct: 35,
};

export interface DesgloseNetoPlataforma {
  /** Lo que pagó el cliente + subsidio de la plataforma. */
  base: number;
  comision: number;
  neto: number;
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const pct = (n: number) => (Number.isFinite(Number(n)) && Number(n) > 0 ? Math.min(Number(n), 100) / 100 : 0);

/** % de comisión que aplica a un tipo de pago. */
export function porcentajeComision(enLinea: boolean, config: ConfigComisionPlataforma = CONFIG_COMISION_DIDI_POR_OMISION): number {
  return enLinea ? config.comisionEnLineaPct : config.comisionEfectivoPct;
}

/**
 * Neto de una venta (o de la parte de una venta pagada con un mismo tipo de pago).
 * `enLinea`: pagado con tarjeta o en la app de la plataforma.
 */
export function netoPlataforma(
  datos: { pagadoCliente: number; subsidio?: number; enLinea: boolean },
  config: ConfigComisionPlataforma = CONFIG_COMISION_DIDI_POR_OMISION,
): DesgloseNetoPlataforma {
  const base = Math.max(0, (Number(datos.pagadoCliente) || 0) + Math.max(0, Number(datos.subsidio) || 0));
  const comision = base * pct(porcentajeComision(datos.enLinea, config));
  return { base: r2(base), comision: r2(comision), neto: r2(base - comision) };
}

/** Métodos que cuentan como "pagado en efectivo". Todo lo demás —pagado en línea, tarjeta,
 *  transferencia— es pago con tarjeta / en la app. */
const METODOS_EFECTIVO = new Set(["EFECTIVO", "EFECTIVO_USD"]);
export function esPagoEnLineaPlataforma(metodo: string): boolean {
  return !METODOS_EFECTIVO.has(metodo);
}

export interface PedidoPlataforma {
  /** Lo que pagó el cliente (total del ticket, ya con la promoción). */
  total: number;
  /** Precio de lista de la plataforma antes de la promoción (subtotal del ticket). */
  subtotal: number;
  pagos: { metodo: string; monto: number }[];
  items: { productoId: string; nombre: string; cantidad: number; importe: number }[];
}

export interface NetoPedidoPlataforma extends DesgloseNetoPlataforma {
  /** Precio de lista. */
  bruto: number;
  /** Promoción que pagó el negocio (bruto − lo que pagó el cliente). */
  descuento: number;
  pagadoCliente: number;
  subsidio: number;
  /** "EN_LINEA", "EFECTIVO" o "MIXTO". */
  tipoPago: "EN_LINEA" | "EFECTIVO" | "MIXTO";
  /** Reparto del neto por producto, proporcional al importe de cada línea. */
  porProducto: { productoId: string; nombre: string; cantidad: number; bruto: number; pagadoCliente: number; subsidio: number; neto: number }[];
}

/**
 * Neto de un pedido completo. Un pago mixto (parte en efectivo, parte con tarjeta) se calcula por
 * partes, cada una con su porcentaje. El subsidio de la plataforma sale de `subsidioPorProducto`
 * (pesos por unidad, capturado en el ERP para las promociones que DiDi cofinancia) y se reparte
 * entre los pagos en proporción a su monto.
 */
export function netoPedidoPlataforma(
  pedido: PedidoPlataforma,
  subsidioPorProducto: Record<string, number> = {},
  config: ConfigComisionPlataforma = CONFIG_COMISION_DIDI_POR_OMISION,
): NetoPedidoPlataforma {
  const pagadoCliente = Math.max(0, Number(pedido.total) || 0);
  const bruto = Math.max(pagadoCliente, Number(pedido.subtotal) || 0);
  const subsidioLinea = (i: PedidoPlataforma["items"][number]) => Math.max(0, Number(subsidioPorProducto[i.productoId]) || 0) * (Number(i.cantidad) || 0);
  const subsidio = pedido.items.reduce((s, i) => s + subsidioLinea(i), 0);

  // Partes por tipo de pago. Sin pagos registrados se trata como pagado en la app (lo normal en
  // un pedido de DiDi Food).
  const pagos = pedido.pagos.filter((p) => (Number(p.monto) || 0) > 0);
  const sumaPagos = pagos.reduce((s, p) => s + Number(p.monto), 0);
  const partes = sumaPagos > 0
    ? [true, false].map((enLinea) => ({ enLinea, fraccion: pagos.filter((p) => esPagoEnLineaPlataforma(p.metodo) === enLinea).reduce((s, p) => s + Number(p.monto), 0) / sumaPagos }))
    : [{ enLinea: true, fraccion: 1 }];

  let comision = 0, neto = 0;
  for (const parte of partes) {
    if (parte.fraccion <= 0) continue;
    const d = netoPlataforma({ pagadoCliente: pagadoCliente * parte.fraccion, subsidio: subsidio * parte.fraccion, enLinea: parte.enLinea }, config);
    comision += d.comision;
    neto += d.neto;
  }
  const enLinea = partes.find((p) => p.enLinea)?.fraccion ?? 0;
  const tipoPago = enLinea >= 0.9999 ? "EN_LINEA" : enLinea <= 0.0001 ? "EFECTIVO" : "MIXTO";

  // Reparto por producto, proporcional al importe de la línea (el descuento y los modificadores
  // del ticket se prorratean).
  const sumaImportes = pedido.items.reduce((s, i) => s + Math.max(0, Number(i.importe) || 0), 0);
  const base = pagadoCliente + subsidio;
  const tasa = base > 0 ? neto / base : 0;
  const porProducto = pedido.items.map((i) => {
    const peso = sumaImportes > 0 ? Math.max(0, Number(i.importe) || 0) / sumaImportes : 1 / Math.max(1, pedido.items.length);
    const sub = subsidioLinea(i);
    return {
      productoId: i.productoId,
      nombre: i.nombre,
      cantidad: Number(i.cantidad) || 0,
      bruto: r2(bruto * peso),
      pagadoCliente: r2(pagadoCliente * peso),
      subsidio: r2(sub),
      // Neto de la línea: su parte de lo pagado + su propio subsidio, a la tasa neta del pedido.
      neto: r2((pagadoCliente * peso + sub) * tasa),
    };
  });

  return {
    bruto: r2(bruto),
    descuento: r2(bruto - pagadoCliente),
    pagadoCliente: r2(pagadoCliente),
    subsidio: r2(subsidio),
    base: r2(base),
    comision: r2(comision),
    neto: r2(neto),
    tipoPago,
    porProducto,
  };
}
