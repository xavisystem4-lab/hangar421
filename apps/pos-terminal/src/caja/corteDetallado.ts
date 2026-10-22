/**
 * Corte de caja desglosado — lógica pura (sin I/O) para la ventana flotante "Ver corte" y para el
 * texto que se comparte/imprime. Probada en corteDetallado.spec.ts.
 *
 * Criterio de cuentas (el mismo que usa el ERP al recibir el corte):
 *  - El FONDO de caja NO es venta: se muestra aparte y solo entra en "efectivo que debe haber en
 *    el cajón".
 *  - VENTAS del turno = tickets cobrados, por método de pago y por origen (mostrador / plataformas).
 *  - Efectivo esperado en cajón = fondo + ventas en efectivo (MXN) + ingresos − egresos.
 *  - El cuadre es del EFECTIVO TOTAL: pesos + dólares al tipo de cambio del turno.
 *  - Un pago mixto ya viene repartido en sus pagos (efectivo, tarjeta…): cada parte suma a su método.
 *  - El CRÉDITO DE EMPLEADO no es venta real (no entró dinero): sale en su propia categoría y no
 *    suma a las ventas del turno.
 */
import { diferenciaTotalEnPesos } from "@hangar421/shared";
import { BILLETES_MXN, BILLETES_USD, MONEDAS_MXN, round2, type Conteo, type DesgloseEfectivo } from "./denominaciones";

export interface MovimientoCorte {
  tipo: "INGRESO" | "EGRESO" | string;
  monto: number;
  motivo?: string | null;
  createdAt?: string;
}

export interface OrigenCorte {
  origen: string;
  total: number;
  cantidad: number;
  porMetodo: { metodo: string; total: number; cantidad: number }[];
}

export interface DatosCorte {
  sucursal?: string | null;
  cajero: string;
  abiertoAt: string;
  /** Momento del corte (al cerrar) o "ahora" si es la vista en vivo. */
  cortadoAt: string;
  cerrado: boolean;
  montoInicial: number;
  tipoCambioUsd?: number | null;
  porOrigen: OrigenCorte[];
  movimientos: MovimientoCorte[];
  /** Ventas en efectivo del turno: pesos (ya restado el cambio de pagos en dólares) y dólares recibidos. */
  ventasEnEfectivo: { mxn: number; usd: number };
  desglose: DesgloseEfectivo;
  descuentos?: { folio: number; motivo: string; valor: number; tipo: string }[];
  /** Tickets cancelados en el turno (informativo). */
  canceladas?: number;
  /** Tickets cobrados con pago mixto (informativo: sus partes ya suman a cada método). */
  ventasMixtas?: number;
  etiquetaMetodo?: (metodo: string) => string;
  etiquetaOrigen?: (origen: string) => string;
}

export interface LineaDenominacion {
  denominacion: number;
  piezas: number;
  subtotal: number;
}

export interface CorteDetallado {
  encabezado: { sucursal: string | null; cajero: string; abiertoAt: string; cortadoAt: string; cerrado: boolean; tipoCambioUsd: number | null };
  fondo: number;
  ventas: {
    total: number;
    tickets: number;
    porMetodo: { metodo: string; etiqueta: string; total: number; cantidad: number }[];
    /** Mostrador primero y luego las plataformas, cada una con su desglose por método. */
    porOrigen: { origen: string; etiqueta: string; total: number; cantidad: number; porMetodo: { metodo: string; etiqueta: string; total: number }[] }[];
    plataformas: number;
    mostrador: number;
    /** Consumo de empleadas a crédito: aparte, no es venta. */
    credito: { total: number; cantidad: number };
    /** Lo cobrado agrupado como lo entienden en caja: efectivo (pesos y dólares), tarjeta, transferencia. */
    cobrado: { efectivoPesos: number; efectivoDolares: number; efectivoTotal: number; tarjeta: number; transferencia: number; otros: number; total: number };
    /** Tickets con pago mixto. */
    mixtas: number;
  };
  ingresos: { lineas: MovimientoCorte[]; total: number };
  egresos: { lineas: MovimientoCorte[]; total: number };
  efectivo: {
    fondo: number;
    ventasEfectivoMxn: number;
    ingresos: number;
    egresos: number;
    esperado: number;
  };
  conteo: {
    billetes: LineaDenominacion[];
    monedas: LineaDenominacion[];
    dolares: LineaDenominacion[];
    totalBilletes: number;
    totalMonedas: number;
    totalMXN: number;
    totalUSD: number;
  };
  resultado: {
    contado: number;
    esperado: number;
    diferencia: number;
    dolaresContados: number;
    dolaresEsperados: number;
    diferenciaUsd: number;
    /** Dólares contados convertidos a pesos (0 sin tipo de cambio). */
    dolaresEnPesos: number;
    /** Efectivo total contado: pesos + dólares en pesos. */
    contadoTotal: number;
    /** Efectivo total esperado: pesos + dólares esperados en pesos. */
    esperadoTotal: number;
    /** La que decide si cuadra (pesos + dólares). */
    diferenciaTotal: number;
    sinTipoCambio: boolean;
  };
  descuentos: { folio: number; motivo: string; valor: number; tipo: string }[];
  canceladas: number;
  observaciones: string | null;
}

const METODO_CREDITO = "MONEDERO_EMPLEADO";
const ORDEN_ORIGEN = ["MOSTRADOR", "DIDI", "UBER", "RAPPI"];
const ORDEN_METODO = ["EFECTIVO", "EFECTIVO_USD", "TARJETA", "TRANSFERENCIA", "QR", "EN_LINEA", "MONEDERO_EMPLEADO", "OTRO"];

function lineasDenominacion(denominaciones: number[], conteo: Conteo): LineaDenominacion[] {
  return denominaciones
    .map((d) => {
      const piezas = Number(conteo[d]);
      const validas = Number.isFinite(piezas) && piezas > 0 ? piezas : 0;
      return { denominacion: d, piezas: validas, subtotal: round2(d * validas) };
    })
    .filter((l) => l.piezas > 0);
}

const porOrden = (orden: string[]) => (a: string, b: string) => {
  const ia = orden.indexOf(a);
  const ib = orden.indexOf(b);
  return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
};

export function armarCorteDetallado(d: DatosCorte): CorteDetallado {
  const etiquetaMetodo = d.etiquetaMetodo ?? ((m) => m);
  const etiquetaOrigen = d.etiquetaOrigen ?? ((o) => o);

  // El crédito de empleado se separa antes de sumar: no es venta.
  const credito = { total: 0, cantidad: 0 };
  for (const o of d.porOrigen) {
    for (const m of o.porMetodo) {
      if (m.metodo !== METODO_CREDITO) continue;
      credito.total = round2(credito.total + m.total);
      credito.cantidad += m.cantidad;
    }
  }
  const origenes = d.porOrigen.map((o) => {
    const deCredito = o.porMetodo.filter((m) => m.metodo === METODO_CREDITO).reduce((s, m) => s + m.total, 0);
    return { ...o, total: round2(o.total - deCredito), porMetodo: o.porMetodo.filter((m) => m.metodo !== METODO_CREDITO) };
  });

  // Ventas por método, sumando todos los orígenes.
  const metodos = new Map<string, { total: number; cantidad: number }>();
  for (const o of origenes) {
    for (const m of o.porMetodo) {
      const acum = metodos.get(m.metodo) ?? { total: 0, cantidad: 0 };
      acum.total = round2(acum.total + m.total);
      acum.cantidad += m.cantidad;
      metodos.set(m.metodo, acum);
    }
  }
  const porMetodo = [...metodos.entries()]
    .sort(([a], [b]) => porOrden(ORDEN_METODO)(a, b))
    .map(([metodo, v]) => ({ metodo, etiqueta: etiquetaMetodo(metodo), total: v.total, cantidad: v.cantidad }));

  const porOrigen = [...origenes]
    .sort((a, b) => porOrden(ORDEN_ORIGEN)(a.origen, b.origen))
    .map((o) => ({
      origen: o.origen,
      etiqueta: etiquetaOrigen(o.origen),
      total: round2(o.total),
      cantidad: o.cantidad,
      porMetodo: [...o.porMetodo].sort((a, b) => porOrden(ORDEN_METODO)(a.metodo, b.metodo)).map((m) => ({ metodo: m.metodo, etiqueta: etiquetaMetodo(m.metodo), total: round2(m.total) })),
    }));
  const totalVentas = round2(porOrigen.reduce((s, o) => s + o.total, 0));
  const tickets = porOrigen.reduce((s, o) => s + o.cantidad, 0);
  const mostrador = round2(porOrigen.filter((o) => o.origen === "MOSTRADOR").reduce((s, o) => s + o.total, 0));
  const plataformas = round2(totalVentas - mostrador);

  const ingresos = d.movimientos.filter((m) => m.tipo === "INGRESO");
  const egresos = d.movimientos.filter((m) => m.tipo === "EGRESO");
  const totalIngresos = round2(ingresos.reduce((s, m) => s + m.monto, 0));
  const totalEgresos = round2(egresos.reduce((s, m) => s + m.monto, 0));

  const deMetodo = (m: string) => porMetodo.filter((x) => x.metodo === m).reduce((s2, x) => s2 + x.total, 0);
  const efectivoPesos = round2(deMetodo("EFECTIVO"));
  const efectivoDolares = round2(deMetodo("EFECTIVO_USD"));
  const tarjeta = round2(deMetodo("TARJETA"));
  const transferencia = round2(deMetodo("TRANSFERENCIA"));
  const cobrado = {
    efectivoPesos, efectivoDolares, efectivoTotal: round2(efectivoPesos + efectivoDolares), tarjeta, transferencia,
    otros: round2(totalVentas - efectivoPesos - efectivoDolares - tarjeta - transferencia), total: totalVentas,
  };

  const fondo = round2(d.montoInicial);
  const esperado = round2(fondo + d.ventasEnEfectivo.mxn + totalIngresos - totalEgresos);

  const tc = d.tipoCambioUsd && d.tipoCambioUsd > 0 ? d.tipoCambioUsd : null;
  const billetes = lineasDenominacion(BILLETES_MXN, d.desglose.billetesMXN);
  const monedas = lineasDenominacion(MONEDAS_MXN, d.desglose.monedasMXN);
  const dolares = lineasDenominacion(BILLETES_USD, d.desglose.billetesUSD);
  const totalBilletes = round2(billetes.reduce((s, l) => s + l.subtotal, 0));
  const totalMonedas = round2(monedas.reduce((s, l) => s + l.subtotal, 0));

  return {
    encabezado: { sucursal: d.sucursal ?? null, cajero: d.cajero, abiertoAt: d.abiertoAt, cortadoAt: d.cortadoAt, cerrado: d.cerrado, tipoCambioUsd: d.tipoCambioUsd ?? null },
    fondo,
    ventas: { total: totalVentas, tickets, porMetodo, porOrigen, plataformas, mostrador, credito, cobrado, mixtas: d.ventasMixtas ?? 0 },
    ingresos: { lineas: ingresos, total: totalIngresos },
    egresos: { lineas: egresos, total: totalEgresos },
    efectivo: { fondo, ventasEfectivoMxn: round2(d.ventasEnEfectivo.mxn), ingresos: totalIngresos, egresos: totalEgresos, esperado },
    conteo: { billetes, monedas, dolares, totalBilletes, totalMonedas, totalMXN: d.desglose.totalMXN, totalUSD: d.desglose.totalUSD },
    resultado: {
      contado: d.desglose.totalMXN,
      esperado,
      diferencia: round2(d.desglose.totalMXN - esperado),
      dolaresContados: d.desglose.totalUSD,
      dolaresEsperados: round2(d.ventasEnEfectivo.usd),
      diferenciaUsd: round2(d.desglose.totalUSD - d.ventasEnEfectivo.usd),
      dolaresEnPesos: tc ? round2(d.desglose.totalUSD * tc) : 0,
      contadoTotal: round2(d.desglose.totalMXN + (tc ? d.desglose.totalUSD * tc : 0)),
      esperadoTotal: round2(esperado + (tc ? d.ventasEnEfectivo.usd * tc : 0)),
      diferenciaTotal: diferenciaTotalEnPesos(d.desglose.totalMXN - esperado, d.desglose.totalUSD - d.ventasEnEfectivo.usd, tc),
      sinTipoCambio: !tc && (d.desglose.totalUSD > 0 || d.ventasEnEfectivo.usd > 0),
    },
    descuentos: d.descuentos ?? [],
    canceladas: d.canceladas ?? 0,
    observaciones: d.desglose.observaciones ?? null,
  };
}

const dinero = (n: number) => `$${n.toFixed(2)}`;
const hora = (iso: string) => {
  const f = new Date(iso);
  return Number.isNaN(f.getTime()) ? iso : f.toLocaleString("es-MX", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

/** Versión en texto plano del corte (para compartir por WhatsApp/correo o imprimir en texto). */
export function textoCorte(c: CorteDetallado): string {
  const L: string[] = [];
  const sep = "──────────────────────────";
  L.push(`HANGAR 421 · CORTE DE CAJA${c.encabezado.cerrado ? "" : " (EN CURSO)"}`);
  if (c.encabezado.sucursal) L.push(`Sucursal: ${c.encabezado.sucursal}`);
  L.push(`Cajero: ${c.encabezado.cajero}`);
  L.push(`Apertura: ${hora(c.encabezado.abiertoAt)}`);
  L.push(`${c.encabezado.cerrado ? "Cierre" : "Consulta"}: ${hora(c.encabezado.cortadoAt)}`);
  if (c.encabezado.tipoCambioUsd) L.push(`Dólar: ${dinero(c.encabezado.tipoCambioUsd)}`);
  L.push(sep);
  L.push(`FONDO DE CAJA (no es venta): ${dinero(c.fondo)}`);
  L.push(sep);
  L.push(`VENTAS DEL TURNO: ${dinero(c.ventas.total)} (${c.ventas.tickets} tickets)`);
  L.push(`  Efectivo: ${dinero(c.ventas.cobrado.efectivoTotal)}${c.ventas.cobrado.efectivoDolares > 0 ? ` (pesos ${dinero(c.ventas.cobrado.efectivoPesos)} + dólares ${dinero(c.ventas.cobrado.efectivoDolares)})` : ""}`);
  L.push(`  Tarjeta: ${dinero(c.ventas.cobrado.tarjeta)}`);
  L.push(`  Transferencia: ${dinero(c.ventas.cobrado.transferencia)}`);
  for (const m of c.ventas.porMetodo.filter((x) => !["EFECTIVO", "EFECTIVO_USD", "TARJETA", "TRANSFERENCIA"].includes(x.metodo))) L.push(`  ${m.etiqueta}: ${dinero(m.total)} (${m.cantidad})`);
  if (c.ventas.mixtas > 0) L.push(`  Pagos mixtos: ${c.ventas.mixtas} ticket(s), ya repartidos por método`);
  L.push(`  Mostrador: ${dinero(c.ventas.mostrador)} · Plataformas: ${dinero(c.ventas.plataformas)}`);
  if (c.ventas.credito.total > 0) L.push(`CRÉDITO DE EMPLEADOS (no es venta): ${dinero(c.ventas.credito.total)} (${c.ventas.credito.cantidad})`);
  for (const o of c.ventas.porOrigen.filter((x) => x.origen !== "MOSTRADOR")) {
    L.push(`  ${o.etiqueta}: ${dinero(o.total)} (${o.cantidad})`);
    for (const m of o.porMetodo) L.push(`     ${m.etiqueta}: ${dinero(m.total)}`);
  }
  L.push(sep);
  L.push(`INGRESOS: ${dinero(c.ingresos.total)}`);
  for (const m of c.ingresos.lineas) L.push(`  + ${dinero(m.monto)} ${m.motivo ?? ""}`.trimEnd());
  L.push(`EGRESOS: ${dinero(c.egresos.total)}`);
  for (const m of c.egresos.lineas) L.push(`  − ${dinero(m.monto)} ${m.motivo ?? ""}`.trimEnd());
  L.push(sep);
  L.push("EFECTIVO QUE DEBE HABER EN CAJÓN");
  L.push(`  Fondo ${dinero(c.efectivo.fondo)} + Ventas efectivo ${dinero(c.efectivo.ventasEfectivoMxn)} + Ingresos ${dinero(c.efectivo.ingresos)} − Egresos ${dinero(c.efectivo.egresos)}`);
  L.push(`  = ${dinero(c.efectivo.esperado)}`);
  L.push(sep);
  L.push("CONTEO POR DENOMINACIÓN");
  if (c.conteo.billetes.length === 0 && c.conteo.monedas.length === 0) L.push("  (sin conteo capturado)");
  for (const b of c.conteo.billetes) L.push(`  Billete ${dinero(b.denominacion)} × ${b.piezas} = ${dinero(b.subtotal)}`);
  if (c.conteo.billetes.length) L.push(`  Billetes: ${dinero(c.conteo.totalBilletes)}`);
  for (const m of c.conteo.monedas) L.push(`  Moneda ${dinero(m.denominacion)} × ${m.piezas} = ${dinero(m.subtotal)}`);
  if (c.conteo.monedas.length) L.push(`  Monedas: ${dinero(c.conteo.totalMonedas)}`);
  for (const u of c.conteo.dolares) L.push(`  US$${u.denominacion} × ${u.piezas} = US$${u.subtotal.toFixed(2)}`);
  L.push(sep);
  L.push(`PESOS CONTADOS: ${dinero(c.resultado.contado)}`);
  if (c.resultado.dolaresContados > 0 || c.resultado.dolaresEsperados > 0) {
    L.push(`DÓLARES CONTADOS: US$${c.resultado.dolaresContados.toFixed(2)}${c.resultado.dolaresEnPesos ? ` = ${dinero(c.resultado.dolaresEnPesos)}` : ""}`);
  }
  L.push(`EFECTIVO TOTAL CONTADO: ${dinero(c.resultado.contadoTotal)}`);
  L.push(`EFECTIVO TOTAL ESPERADO: ${dinero(c.resultado.esperadoTotal)}`);
  const dif = c.resultado.diferenciaTotal;
  L.push(`DIFERENCIA: ${Math.abs(dif) < 1 ? "CUADRA" : `${dif > 0 ? "SOBRAN" : "FALTAN"} ${dinero(Math.abs(dif))}`}`);
  if (c.descuentos.length > 0) {
    L.push(sep);
    L.push(`DESCUENTOS (${c.descuentos.length})`);
    for (const x of c.descuentos) L.push(`  #${x.folio} · ${x.motivo}`);
  }
  if (c.canceladas > 0) L.push(`Tickets cancelados: ${c.canceladas}`);
  if (c.observaciones) {
    L.push(sep);
    L.push(`Observaciones: ${c.observaciones}`);
  }
  return L.join("\n");
}
