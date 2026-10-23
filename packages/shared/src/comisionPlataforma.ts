/**
 * Cuánto le queda al negocio de una venta por plataforma de reparto (DiDi Food), ya descontada la
 * comisión. Lo usan el reporte "DiDi" del ERP y quien quiera mostrar el neto de un pedido.
 *
 * Reproduce la hoja de cálculo con que Hangar 421 lleva sus precios de DiDi:
 *
 *   base     = lo que pagó el cliente + lo que subsidia DiDi en esa promoción
 *   comisión = base × comisión% × (1 + IVA de la comisión)        → 30 % + IVA = 34.8 %
 *   retención (solo pedidos pagados en la app / con tarjeta)
 *            = (base ÷ (1 + IVA de la venta)) × retención%         → 10.5 % del precio sin IVA
 *   neto     = base − comisión − retención
 *
 * Con los valores por omisión: un pedido de $100 en efectivo deja ≈ $65.20 y pagado en la app
 * ≈ $56.15 — los mismos "monto a recibir aprox." de la hoja (Latte Frío $110 → $72 / $62).
 * Todo es configurable en el ERP porque la comisión pactada cambia por tienda y por campaña.
 */

export interface ConfigComisionPlataforma {
  /** Comisión de la plataforma sobre la base, en % (30 = 30 %). */
  comisionPct: number;
  /** IVA que la plataforma cobra sobre su comisión, en %. */
  ivaComisionPct: number;
  /** Retenciones de impuestos que la plataforma aplica a lo cobrado en la app (ISR + IVA), en %
   *  sobre el precio sin IVA. No se aplican a los pedidos que el cliente paga en efectivo. */
  retencionPct: number;
  /** IVA incluido en el precio de venta, en % — para sacar el precio sin IVA de la retención. */
  ivaVentaPct: number;
}

export const CONFIG_COMISION_DIDI_POR_OMISION: ConfigComisionPlataforma = {
  comisionPct: 30,
  ivaComisionPct: 16,
  retencionPct: 10.5,
  ivaVentaPct: 16,
};

export interface DesgloseNetoPlataforma {
  /** Lo que pagó el cliente + subsidio de la plataforma. */
  base: number;
  comision: number;
  retencion: number;
  neto: number;
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const pct = (n: number) => (Number.isFinite(Number(n)) && Number(n) > 0 ? Number(n) / 100 : 0);

/**
 * Neto de una venta (o de la parte de una venta pagada con un mismo tipo de pago).
 * `enLinea`: pagado en la app de la plataforma o con tarjeta → lleva retenciones.
 */
export function netoPlataforma(
  datos: { pagadoCliente: number; subsidio?: number; enLinea: boolean },
  config: ConfigComisionPlataforma = CONFIG_COMISION_DIDI_POR_OMISION,
): DesgloseNetoPlataforma {
  const base = Math.max(0, (Number(datos.pagadoCliente) || 0) + Math.max(0, Number(datos.subsidio) || 0));
  const comision = base * pct(config.comisionPct) * (1 + pct(config.ivaComisionPct));
  const retencion = datos.enLinea ? (base / (1 + pct(config.ivaVentaPct))) * pct(config.retencionPct) : 0;
  return { base: r2(base), comision: r2(comision), retencion: r2(retencion), neto: r2(base - comision - retencion) };
}

/** Métodos que cuentan como "pagado en efectivo" (sin retención). Todo lo demás —pagado en
 *  línea, tarjeta, transferencia— lo cobró la plataforma. */
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
 * Neto de un pedido completo. Un pago mixto (parte en efectivo, parte en la app) se calcula por
 * partes, cada una con su regla. El subsidio de la plataforma sale de `subsidioPorProducto`
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

  let comision = 0, retencion = 0, neto = 0;
  for (const parte of partes) {
    if (parte.fraccion <= 0) continue;
    const d = netoPlataforma({ pagadoCliente: pagadoCliente * parte.fraccion, subsidio: subsidio * parte.fraccion, enLinea: parte.enLinea }, config);
    comision += d.comision; retencion += d.retencion; neto += d.neto;
  }
  const enLinea = partes.find((p) => p.enLinea)?.fraccion ?? 0;
  const tipoPago = enLinea >= 0.9999 ? "EN_LINEA" : enLinea <= 0.0001 ? "EFECTIVO" : "MIXTO";

  // Reparto por producto, proporcional al importe de la línea (el descuento y los modificadores
  // del ticket se prorratean igual que en la hoja).
  const sumaImportes = pedido.items.reduce((s, i) => s + Math.max(0, Number(i.importe) || 0), 0);
  const base = pagadoCliente + subsidio;
  const tasa = base > 0 ? neto / base : 0;
  const porProducto = pedido.items.map((i) => {
    const peso = sumaImportes > 0 ? Math.max(0, Number(i.importe) || 0) / sumaImportes : 1 / Math.max(1, pedido.items.length);
    const sub = subsidioLinea(i);
    // Neto de la línea: su parte de lo pagado + su propio subsidio, a la tasa neta del pedido.
    return {
      productoId: i.productoId,
      nombre: i.nombre,
      cantidad: Number(i.cantidad) || 0,
      bruto: r2(bruto * peso),
      pagadoCliente: r2(pagadoCliente * peso),
      subsidio: r2(sub),
      neto: r2((pagadoCliente * peso + sub) * tasa),
    };
  });

  return {
    bruto: r2(bruto),
    descuento: r2(bruto - pagadoCliente),
    pagadoCliente: r2(pagadoCliente),
    subsidio: r2(subsidio),
    base: r2(pagadoCliente + subsidio),
    comision: r2(comision),
    retencion: r2(retencion),
    neto: r2(neto),
    tipoPago,
    porProducto,
  };
}
