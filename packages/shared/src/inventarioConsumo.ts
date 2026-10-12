/**
 * Qué consume del inventario una venta — regla única para el ERP y para la tablet.
 *
 * El consumo de un renglón es la receta FIJA del producto (café, vaso) más la receta de cada
 * OPCIÓN de modificador elegida (leche de avena, shot extra), todo por la cantidad del renglón.
 *
 * Existe porque listar las cinco leches en la receta del Latte hacía que cada venta descontara
 * las cinco: la leche no es del producto, es de la opción que eligió el cliente.
 */

export interface LineaReceta {
  insumoId: string;
  cantidad: number;
}

export interface ItemParaConsumo {
  productoId: string;
  cantidad: number;
  /** Opciones de modificador elegidas en ESTE renglón; repetidas consumen varias veces. */
  modificadores?: { opcionModificadorId: string }[];
}

export interface RecetasDisponibles {
  /** Receta fija por producto. */
  porProducto: Record<string, LineaReceta[]>;
  /** Receta por opción de modificador. */
  porOpcion: Record<string, LineaReceta[]>;
}

/** 4 decimales, como la columna de existencias: en gramos y mililitros el redondeo a 2 perdería
 *  fracciones reales de receta. */
function redondear4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10_000) / 10_000;
}

/**
 * Suma, insumo por insumo, lo que consumen los renglones de una venta. El resultado sale ordenado
 * por insumoId para que dos cálculos de la misma venta sean idénticos (y comparables en pruebas).
 */
export function consumoDeVenta(items: ItemParaConsumo[], recetas: RecetasDisponibles): LineaReceta[] {
  const porInsumo = new Map<string, number>();
  const sumar = (insumoId: string, cantidadUnitaria: number, veces: number) => {
    if (!(cantidadUnitaria > 0) || !(veces > 0)) return;
    porInsumo.set(insumoId, (porInsumo.get(insumoId) ?? 0) + cantidadUnitaria * veces);
  };

  for (const item of items) {
    for (const r of recetas.porProducto[item.productoId] ?? []) sumar(r.insumoId, r.cantidad, item.cantidad);
    for (const m of item.modificadores ?? []) {
      for (const r of recetas.porOpcion[m.opcionModificadorId] ?? []) sumar(r.insumoId, r.cantidad, item.cantidad);
    }
  }

  return [...porInsumo.entries()]
    .map(([insumoId, cantidad]) => ({ insumoId, cantidad: redondear4(cantidad) }))
    .sort((a, b) => a.insumoId.localeCompare(b.insumoId));
}

/** Agrupa filas planas (como vienen de la base) en el mapa que espera `consumoDeVenta`. */
export function agruparRecetas(
  filasProducto: { productoId: string; insumoId: string; cantidad: number }[],
  filasOpcion: { opcionModificadorId: string; insumoId: string; cantidad: number }[],
): RecetasDisponibles {
  const porProducto: Record<string, LineaReceta[]> = {};
  const porOpcion: Record<string, LineaReceta[]> = {};
  for (const f of filasProducto) (porProducto[f.productoId] ??= []).push({ insumoId: f.insumoId, cantidad: Number(f.cantidad) });
  for (const f of filasOpcion) (porOpcion[f.opcionModificadorId] ??= []).push({ insumoId: f.insumoId, cantidad: Number(f.cantidad) });
  return { porProducto, porOpcion };
}
