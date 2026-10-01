import { calcularCortesia, round2, type TotalesPedido } from "@hangar421/shared";
import type { ItemCarrito } from "../store/carritoStore";

/**
 * Cortesía en el cobro: la casa regala los productos y el cajero elige cuáles extras (leche de
 * avena, shot extra…) sí se cobran. Lógica pura para probarla con Jest (cortesia.spec.ts); el
 * cálculo del dinero en sí vive en packages/shared (calcularCortesia), igual que en el backend.
 */

export interface ExtraCobrable {
  /** `${itemId}:${opcionModificadorId}` — identifica el extra de UNA línea del carrito. */
  clave: string;
  nombreProducto: string;
  nombreExtra: string;
  precioExtra: number;
  cantidad: number;
  /** precioExtra × cantidad de la línea. */
  importe: number;
}

/** Extras con precio de todas las líneas del carrito (los de $0 no hay nada que decidir). */
export function extrasCobrables(items: ItemCarrito[]): ExtraCobrable[] {
  const extras: ExtraCobrable[] = [];
  for (const item of items) {
    for (const m of item.modificadores ?? []) {
      if (!(m.precioExtra > 0)) continue;
      extras.push({
        clave: `${item.id}:${m.opcionModificadorId}`,
        nombreProducto: item.nombreProducto,
        nombreExtra: m.nombreOpcion,
        precioExtra: m.precioExtra,
        cantidad: item.cantidad,
        importe: round2(m.precioExtra * item.cantidad),
      });
    }
  }
  return extras;
}

/** Totales de la venta en cortesía: el subtotal real, lo regalado como descuento y el total que sí paga el cliente. */
export function totalesConCortesia(totales: TotalesPedido, items: ItemCarrito[], clavesCobradas: Iterable<string>): TotalesPedido {
  const cobradas = new Set(clavesCobradas);
  const totalACobrar = round2(extrasCobrables(items).filter((e) => cobradas.has(e.clave)).reduce((s, e) => s + e.importe, 0));
  const { montoCortesia, total } = calcularCortesia(totales.subtotal, totalACobrar);
  return { subtotal: totales.subtotal, descuentoTotal: montoCortesia, impuesto: totales.impuesto, total };
}

/** "Cortesía — autorizó Ana López — se cobró: Leche de avena" — viaja como motivo del descuento. */
export function motivoCortesia(autorizadoPor: string, items: ItemCarrito[], clavesCobradas: Iterable<string>): string {
  const cobradas = new Set(clavesCobradas);
  const nombres = extrasCobrables(items).filter((e) => cobradas.has(e.clave)).map((e) => e.nombreExtra);
  return ["Cortesía", `autorizó ${autorizadoPor}`, nombres.length > 0 ? `se cobró: ${nombres.join(", ")}` : null].filter(Boolean).join(" — ");
}
