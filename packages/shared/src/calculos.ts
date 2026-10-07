import { TipoDescuento, TipoMovimientoInventario } from "./enums";

/** Funciones puras de negocio (sin dependencias de Prisma/Nest) — testeadas en calculos.spec.ts.
 *  Se usan tanto en PedidosService como en InventarioService para no duplicar reglas. */

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface ItemParaTotal {
  precioUnitario: number;
  cantidad: number;
  modificadoresPrecio?: number; // suma de precioExtra de los modificadores seleccionados
}

export function calcularSubtotal(items: ItemParaTotal[]): number {
  const subtotal = items.reduce(
    (acc, it) => acc + (it.precioUnitario + (it.modificadoresPrecio ?? 0)) * it.cantidad,
    0,
  );
  return round2(subtotal);
}

export function calcularMontoDescuento(tipo: TipoDescuento, valor: number, subtotal: number): number {
  if (valor < 0) throw new Error("El valor del descuento no puede ser negativo");
  const monto = tipo === TipoDescuento.PORCENTAJE ? subtotal * (valor / 100) : valor;
  return round2(Math.min(monto, subtotal)); // nunca descuenta más que el subtotal
}

export function calcularImpuesto(baseGravable: number, tasaImpuesto: number): number {
  return round2(Math.max(baseGravable, 0) * tasaImpuesto);
}

export interface TotalesPedido {
  subtotal: number;
  descuentoTotal: number;
  impuesto: number;
  total: number;
}

/** Los precios del catálogo son finales (ya incluyen cualquier impuesto) — no se suma nada
 *  encima al cobrar, así que `impuesto` siempre es 0 y el total es subtotal menos descuentos.
 *  `tasaImpuesto` se conserva en la firma por compatibilidad con quien la llame y por si algún
 *  reporte fiscal necesita más adelante desglosar cuánto de ese precio final es impuesto (sin
 *  volver a sumarlo), pero no participa en el cálculo del total a cobrar. */
export function calcularTotalesPedido(
  items: ItemParaTotal[],
  descuentos: { tipo: TipoDescuento; valor: number }[],
  _tasaImpuesto: number,
): TotalesPedido {
  const subtotal = calcularSubtotal(items);
  const descuentoTotal = round2(
    descuentos.reduce((acc, d) => acc + calcularMontoDescuento(d.tipo, d.valor, subtotal - acc), 0),
  );
  const total = round2(subtotal - descuentoTotal);
  return { subtotal, descuentoTotal, impuesto: 0, total };
}

/**
 * Cortesía: la casa no cobra los productos, solo los extras que el cajero decide cobrar
 * (`totalACobrar`, que puede ser 0). Se registra como un descuento de tipo MONTO por la
 * diferencia, así el subtotal conserva el valor real de lo regalado para los reportes.
 *
 * El backend la recalcula con SUS precios: si el catálogo del ERP difiere del de la tablet, lo
 * que se respeta es lo que el cliente pagó (`totalACobrar`), y el descuento absorbe la diferencia.
 */
export function calcularCortesia(subtotal: number, totalACobrar: number): { montoCortesia: number; total: number } {
  const total = round2(Math.min(Math.max(totalACobrar, 0), subtotal));
  return { montoCortesia: round2(subtotal - total), total };
}

/** Pagos mixtos: la suma de los pagos debe cubrir el total (puede exceder — habrá cambio en efectivo). */
export function validarPagoSuficiente(pagos: { monto: number }[], total: number): { suficiente: boolean; totalPagado: number; faltante: number } {
  const totalPagado = round2(pagos.reduce((acc, p) => acc + p.monto, 0));
  const faltante = round2(Math.max(total - totalPagado, 0));
  return { suficiente: totalPagado >= total, totalPagado, faltante };
}

/**
 * Cobro con billetes en dólares y cambio en pesos.
 *
 * Ej.: cuenta $300, dólar a $18.50, paga US$20 → equivale a $370 y se le dan $70 de cambio.
 * El pago se registra por los $300 que cubre (así el total por método cuadra con la venta) y
 * los US$20 y el tipo de cambio aparte; el cambio sale del cajón de PESOS.
 */
export function cobroEnDolares(totalMxn: number, usdRecibidos: number, tipoCambio: number): {
  equivalenteMxn: number;
  suficiente: boolean;
  faltanteMxn: number;
  cambioMxn: number;
} {
  const equivalenteMxn = round2(usdRecibidos * tipoCambio);
  const faltanteMxn = round2(Math.max(totalMxn - equivalenteMxn, 0));
  return {
    equivalenteMxn,
    suficiente: tipoCambio > 0 && equivalenteMxn >= totalMxn,
    faltanteMxn,
    cambioMxn: round2(Math.max(equivalenteMxn - totalMxn, 0)),
  };
}

/**
 * Efectivo que debe haber en caja al corte, por moneda.
 *
 * `monto` de cada pago es lo que cubrió de la venta en pesos (no lo que entregó el cliente). En
 * EFECTIVO entran esos pesos; en EFECTIVO_USD entran los dólares y SALEN del cajón de pesos los
 * de cambio (equivalente − monto). Otros métodos no tocan el cajón.
 */
export function efectivoEsperadoPorMoneda(datos: {
  montoInicial: number;
  pagos: { metodo: string; monto: number; montoUsd?: number | null; tipoCambio?: number | null }[];
  ingresos: number;
  egresos: number;
}): { mxn: number; usd: number } {
  let mxn = datos.montoInicial + datos.ingresos - datos.egresos;
  let usd = 0;
  for (const p of datos.pagos) {
    if (p.metodo === "EFECTIVO") mxn += p.monto;
    else if (p.metodo === "EFECTIVO_USD") {
      const recibidos = Number(p.montoUsd ?? 0);
      usd += recibidos;
      mxn -= Math.max(round2(recibidos * Number(p.tipoCambio ?? 0)) - p.monto, 0);
    }
  }
  return { mxn: round2(mxn), usd: round2(usd) };
}

/** Diferencia detectada al recibir un traspaso — positiva si llegó de más, negativa si hubo merma
 *  en tránsito. Se usa para la validación final del flujo de traspasos entre sucursales. */
export function calcularDiferenciaTraspaso(cantidadEnviada: number, cantidadRecibida: number): number {
  return round2(cantidadRecibida - cantidadEnviada);
}

/** ENTRADA/TRASPASO_ENTRADA suman, SALIDA/MERMA/TRASPASO_SALIDA restan (magnitud absoluta).
 *  AJUSTE/CONTEO se aplican con el signo que envía el cliente (puede ser +/-). */
export function deltaExistenciaInventario(tipo: TipoMovimientoInventario, cantidad: number): number {
  switch (tipo) {
    case TipoMovimientoInventario.ENTRADA:
    case TipoMovimientoInventario.TRASPASO_ENTRADA:
      return Math.abs(cantidad);
    case TipoMovimientoInventario.SALIDA:
    case TipoMovimientoInventario.MERMA:
    case TipoMovimientoInventario.TRASPASO_SALIDA:
      return -Math.abs(cantidad);
    case TipoMovimientoInventario.AJUSTE:
    case TipoMovimientoInventario.CONTEO:
    default:
      return cantidad;
  }
}

export type NivelInventario = "CRITICO" | "BAJO" | "OPTIMO";

export interface ResultadoNivelInventario {
  /** 0-100, qué tan llena se ve la barra de nivel. Referencia: el máximo si está definido,
   *  o el doble del mínimo como "lleno" virtual cuando no hay máximo capturado. */
  porcentaje: number;
  nivel: NivelInventario;
}

/** Clasifica la existencia de un insumo para la barra de "Nivel" y la píldora de "Estado" del
 *  módulo de inventario (mismo criterio en crm-web y pos-desktop, ver INVENTARIO_UI.md). Sin
 *  mínimo capturado (0 o no definido) no hay forma de juzgar el nivel — siempre OPTIMO. */
export function calcularNivelInventario(existencia: number, minimo: number, maximo?: number | null): ResultadoNivelInventario {
  if (!minimo || minimo <= 0) return { porcentaje: 100, nivel: "OPTIMO" };

  const referenciaLlena = maximo && maximo > minimo ? maximo : minimo * 2;
  const porcentaje = Math.max(0, Math.min(100, round2((existencia / referenciaLlena) * 100)));

  const ratio = existencia / minimo;
  const nivel: NivelInventario = ratio <= 1 ? "CRITICO" : ratio <= 1.5 ? "BAJO" : "OPTIMO";

  return { porcentaje, nivel };
}

export interface DescuentoVenta {
  tipo: TipoDescuento;
  valor: number;
}

export interface LineaConDescuento extends ItemParaTotal {
  /** Descuento propio de esta línea (descuento "por producto"). */
  descuento?: DescuentoVenta | null;
}

export interface ResultadoDescuentosVenta extends TotalesPedido {
  /** Suma de los descuentos por producto. */
  descuentoProductos: number;
  /** Descuento general, calculado sobre lo que queda tras los descuentos por producto. */
  descuentoGeneral: number;
  /** Descuento aplicado a cada línea, en el mismo orden que `lineas`. */
  porLinea: number[];
}

/**
 * Descuentos de una venta, de dos tipos que se pueden combinar:
 *  - POR PRODUCTO: sobre el importe de UNA línea (precio + extras) × cantidad. Un monto fijo se
 *    toma de la línea completa, no por pieza, y nunca excede lo que vale la línea.
 *  - GENERAL: sobre toda la cuenta, DESPUÉS de los descuentos por producto (así el porcentaje
 *    general no descuenta dos veces lo que ya se rebajó).
 * Los precios del catálogo ya son finales, por eso `impuesto` es 0 (ver calcularTotalesPedido).
 */
export function calcularDescuentosVenta(lineas: LineaConDescuento[], general?: DescuentoVenta | null): ResultadoDescuentosVenta {
  const subtotal = calcularSubtotal(lineas);
  const porLinea = lineas.map((l) => {
    if (!l.descuento) return 0;
    return calcularMontoDescuento(l.descuento.tipo, l.descuento.valor, calcularSubtotal([l]));
  });
  const descuentoProductos = round2(porLinea.reduce((acc, d) => acc + d, 0));
  const descuentoGeneral = general ? calcularMontoDescuento(general.tipo, general.valor, round2(subtotal - descuentoProductos)) : 0;
  const descuentoTotal = round2(descuentoProductos + descuentoGeneral);
  return { subtotal, descuentoProductos, descuentoGeneral, descuentoTotal, impuesto: 0, total: round2(subtotal - descuentoTotal), porLinea };
}
