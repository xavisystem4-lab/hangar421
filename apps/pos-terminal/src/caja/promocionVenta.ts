import { mejorPromocion, type Promocion } from "@hangar421/shared";

/** Precio de un producto al agregarlo a la venta, con la mejor promoción vigente en ese momento
 *  (fecha, día y horario de la tablet). Lógica pura (promocionVenta.spec.ts): la regla de precio
 *  vive en packages/shared, la misma que recalcula el servidor. Sin promoción devuelve el precio
 *  de catálogo y ningún dato de promoción. */
export interface PrecioDeVenta {
  precioUnitario: number;
  promocionId?: string;
  nombrePromocion?: string;
  /** Precio de catálogo, solo cuando hay promoción (para mostrar "antes $X"). */
  precioLista?: number;
}

export function precioDeVenta(
  promociones: Promocion[],
  producto: { id: string; precioBase: number },
  ahora: Date,
  sucursalId?: string | null,
): PrecioDeVenta {
  const mejor = mejorPromocion(promociones, producto.id, producto.precioBase, ahora, sucursalId);
  if (!mejor) return { precioUnitario: producto.precioBase };
  return {
    precioUnitario: mejor.precio,
    promocionId: mejor.promocion.id,
    nombrePromocion: mejor.promocion.nombre,
    precioLista: producto.precioBase,
  };
}
