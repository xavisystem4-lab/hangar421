import { TipoDescuento, calcularDescuentosVenta, round2, type DescuentoVenta, type ResultadoDescuentosVenta } from "@hangar421/shared";
import type { ItemCarrito } from "../store/carritoStore";

/**
 * Descuentos en el cobro. El cajero los aplica SIN PIN (a diferencia de la cortesía) y pueden ser
 * de dos clases que se combinan: GENERAL (toda la cuenta) y POR PRODUCTO (una línea del carrito).
 * Cada uno es un porcentaje o un monto fijo. Lógica pura para probarla con Jest
 * (descuentoVenta.spec.ts); el dinero lo calcula packages/shared (calcularDescuentosVenta), igual
 * que el backend.
 */

export interface DescuentosVenta {
  general: DescuentoVenta | null;
  /** Descuento de cada línea, por `ItemCarrito.id`. */
  porProducto: Record<string, DescuentoVenta>;
}

export const SIN_DESCUENTOS: DescuentosVenta = { general: null, porProducto: {} };

export function hayDescuentos(d: DescuentosVenta): boolean {
  return d.general != null || Object.keys(d.porProducto).length > 0;
}

/** null = válido; si no, el mensaje para el cajero. */
export function validarDescuento(tipo: TipoDescuento, valor: number): string | null {
  if (!Number.isFinite(valor) || valor <= 0) return "Escribe un valor mayor que 0.";
  if (tipo === TipoDescuento.PORCENTAJE && valor > 100) return "El porcentaje no puede ser mayor a 100.";
  return null;
}

/** "10%" o "$25.00". */
export function etiquetaDescuento(d: DescuentoVenta): string {
  return d.tipo === TipoDescuento.PORCENTAJE ? `${round2(d.valor)}%` : `$${d.valor.toFixed(2)}`;
}

/** Totales de la cuenta con sus descuentos. Si un descuento de producto quedó apuntando a una
 *  línea que ya no está en el carrito, simplemente no cuenta. */
export function totalesConDescuentos(items: ItemCarrito[], descuentos: DescuentosVenta): ResultadoDescuentosVenta {
  return calcularDescuentosVenta(
    items.map((i) => ({
      precioUnitario: i.precioUnitario,
      cantidad: i.cantidad,
      modificadoresPrecio: i.modificadores.reduce((s, m) => s + m.precioExtra, 0),
      descuento: descuentos.porProducto[i.id] ?? null,
    })),
    descuentos.general,
  );
}

/** Motivo que se guarda con el descuento (ticket, reportes y ERP). */
export function motivoDescuentoProducto(nombreProducto: string, d: DescuentoVenta): string {
  return `Descuento ${etiquetaDescuento(d)}: ${nombreProducto}`;
}

export function motivoDescuentoGeneral(d: DescuentoVenta): string {
  return `Descuento general ${etiquetaDescuento(d)}`;
}
