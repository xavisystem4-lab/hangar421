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

export function calcularTotalesPedido(
  items: ItemParaTotal[],
  descuentos: { tipo: TipoDescuento; valor: number }[],
  tasaImpuesto: number,
): TotalesPedido {
  const subtotal = calcularSubtotal(items);
  const descuentoTotal = round2(
    descuentos.reduce((acc, d) => acc + calcularMontoDescuento(d.tipo, d.valor, subtotal - acc), 0),
  );
  const baseGravable = subtotal - descuentoTotal;
  const impuesto = calcularImpuesto(baseGravable, tasaImpuesto);
  const total = round2(baseGravable + impuesto);
  return { subtotal, descuentoTotal, impuesto, total };
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
