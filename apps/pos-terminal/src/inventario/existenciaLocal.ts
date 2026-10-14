/**
 * Existencia que enseña la tablet = cifra oficial del ERP + lo que esta tablet hizo y todavía no
 * sube. Lógica pura, probada en existenciaLocal.spec.ts.
 *
 * Por qué: la descarga del inventario trae la foto del ERP, que aún no incluye las ventas o los
 * conteos que siguen en la cola. Pisar la existencia local con esa foto hacía que el almacén
 * "brincara" hacia arriba entre una venta y su subida (y que un conteo recién hecho se perdiera
 * de la pantalla hasta que el ERP lo recibía). Al volver a aplicar lo pendiente encima, la
 * pantalla siempre muestra lo que de verdad queda.
 */
export type TipoAjustePendiente = "FIJAR" | "SUMAR" | "RESTAR";

export interface AjustePendiente {
  insumoId: string;
  tipo: TipoAjustePendiente;
  cantidad: number;
  /** ISO; ordena los ajustes (un conteo fija la cifra y lo anterior a él ya no cuenta). */
  fecha: string;
}

/** CONTEO fija; ENTRADA y AJUSTE suman; SALIDA, MERMA y el resto restan (igual que el backend). */
export function tipoDeMovimiento(tipo: string): TipoAjustePendiente {
  if (tipo === "CONTEO") return "FIJAR";
  if (tipo === "ENTRADA" || tipo === "AJUSTE") return "SUMAR";
  return "RESTAR";
}

/**
 * Aplica los ajustes pendientes, en orden de fecha, sobre la existencia oficial. Devuelve solo
 * los insumos que cambiaron.
 */
export function aplicarPendientes(oficial: Map<string, number>, ajustes: AjustePendiente[]): Map<string, number> {
  const resultado = new Map<string, number>();
  const ordenados = [...ajustes].sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
  for (const a of ordenados) {
    const cantidad = Number(a.cantidad);
    if (!Number.isFinite(cantidad)) continue;
    const actual = resultado.has(a.insumoId) ? resultado.get(a.insumoId)! : oficial.get(a.insumoId) ?? 0;
    const nueva = a.tipo === "FIJAR" ? cantidad : a.tipo === "SUMAR" ? actual + cantidad : actual - cantidad;
    resultado.set(a.insumoId, Math.round(nueva * 1000) / 1000);
  }
  return resultado;
}
