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

/** Pagos mixtos: la suma de los pagos debe cubrir el total (puede exceder — habrá cambio en efectivo). */
export function validarPagoSuficiente(pagos: { monto: number }[], total: number): { suficiente: boolean; totalPagado: number; faltante: number } {
  const totalPagado = round2(pagos.reduce((acc, p) => acc + p.monto, 0));
  const faltante = round2(Math.max(total - totalPagado, 0));
  return { suficiente: totalPagado >= total, totalPagado, faltante };
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
