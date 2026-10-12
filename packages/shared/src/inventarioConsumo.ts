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
  /**
   * Receta de las PREPARACIONES que se hacen en la casa (Cold foam blue matcha = 35 g de crema
   * batida + 15 g de agave + 2 g de blue matcha), por UNA unidad de la preparación. Una
   * preparación se usa como cualquier insumo en otras recetas, y al vender se descuentan sus
   * ingredientes, no la preparación.
   */
  porPreparacion?: Record<string, LineaReceta[]>;
}

/** Hasta cuántos niveles se abre una preparación dentro de otra (una salsa dentro de un relleno). */
export const PROFUNDIDAD_MAX_PREPARACION = 5;

/**
 * Cambia cada preparación por sus ingredientes (× la cantidad usada), en cascada. Lo que no es
 * preparación se queda igual. Un ciclo (A lleva B y B lleva A) o pasarse de profundidad deja la
 * línea como insumo normal en vez de colgarse: el ERP ya impide guardar ciclos, esto es la red.
 */
export function expandirPreparaciones(
  lineas: LineaReceta[],
  porPreparacion: Record<string, LineaReceta[]> | undefined,
): LineaReceta[] {
  if (!porPreparacion || Object.keys(porPreparacion).length === 0) return lineas;
  const salida: LineaReceta[] = [];
  const abrir = (insumoId: string, cantidad: number, camino: string[]) => {
    const receta = porPreparacion[insumoId];
    if (!receta || receta.length === 0 || camino.includes(insumoId) || camino.length >= PROFUNDIDAD_MAX_PREPARACION) {
      salida.push({ insumoId, cantidad });
      return;
    }
    for (const r of receta) abrir(r.insumoId, r.cantidad * cantidad, [...camino, insumoId]);
  };
  for (const l of lineas) abrir(l.insumoId, l.cantidad, []);
  return salida;
}

/**
 * ¿Guardar esta receta en la preparación crearía un ciclo? (Cold foam lleva Crema y Crema lleva
 * Cold foam.) Se revisa antes de guardar para que nunca llegue a la base.
 */
export function creaCicloDePreparacion(
  preparacionId: string,
  ingredientes: string[],
  porPreparacion: Record<string, LineaReceta[]>,
): boolean {
  const visitados = new Set<string>();
  const pendientes = [...ingredientes];
  while (pendientes.length > 0) {
    const id = pendientes.pop()!;
    if (id === preparacionId) return true;
    if (visitados.has(id)) continue;
    visitados.add(id);
    for (const r of porPreparacion[id] ?? []) pendientes.push(r.insumoId);
  }
  return false;
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

  const abrir = (lineas: LineaReceta[]) => expandirPreparaciones(lineas, recetas.porPreparacion);
  for (const item of items) {
    for (const r of abrir(recetas.porProducto[item.productoId] ?? [])) sumar(r.insumoId, r.cantidad, item.cantidad);
    for (const m of item.modificadores ?? []) {
      for (const r of abrir(recetas.porOpcion[m.opcionModificadorId] ?? [])) sumar(r.insumoId, r.cantidad, item.cantidad);
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
  filasPreparacion: { preparacionId: string; insumoId: string; cantidad: number }[] = [],
): RecetasDisponibles {
  const porProducto: Record<string, LineaReceta[]> = {};
  const porOpcion: Record<string, LineaReceta[]> = {};
  const porPreparacion: Record<string, LineaReceta[]> = {};
  for (const f of filasProducto) (porProducto[f.productoId] ??= []).push({ insumoId: f.insumoId, cantidad: Number(f.cantidad) });
  for (const f of filasOpcion) (porOpcion[f.opcionModificadorId] ??= []).push({ insumoId: f.insumoId, cantidad: Number(f.cantidad) });
  for (const f of filasPreparacion) (porPreparacion[f.preparacionId] ??= []).push({ insumoId: f.insumoId, cantidad: Number(f.cantidad) });
  return { porProducto, porOpcion, porPreparacion };
}
