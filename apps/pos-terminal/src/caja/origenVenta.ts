/**
 * Origen de una venta para el corte: mostrador o una plataforma de delivery. Funciones puras, sin
 * I/O, para poder probarlas con Jest.
 *
 * Una venta cobrada desde el grupo DIDI del menú (productos con los precios de DiDi Food) se marca
 * como venta de DiDi para que el corte la separe de las del mostrador. Los pedidos que llegan por
 * la integración (Admin → Delivery) se marcan con su plataforma al aceptarlos.
 */

export type CodigoOrigen = "DIDI" | "UBER" | "RAPPI";

/** Nombre de la categoría del catálogo con el menú de DiDi (ver migración menu_benito_juarez_y_didi). */
export const CATEGORIA_DIDI = "DIDI";

const sinAcentos = (s: string) =>
  s.normalize("NFD").replace(/\p{Mn}+/gu, "").trim().toLowerCase();

/**
 * true si TODOS los productos del carrito son del grupo DIDI. Un carrito mezclado (algo de DIDI y
 * algo del mostrador) no se marca: los precios de DiDi y los del mostrador no se combinan en una
 * misma cuenta, así que se trata como mostrador y la pantalla de cobro lo advierte.
 */
export function esVentaDidi(categorias: (string | null | undefined)[]): boolean {
  if (categorias.length === 0) return false;
  return categorias.every((c) => c != null && sinAcentos(c) === sinAcentos(CATEGORIA_DIDI));
}

/** true si hay productos de DIDI mezclados con otros (para advertir en el cobro). */
export function carritoMezclaDidi(categorias: (string | null | undefined)[]): boolean {
  const didi = categorias.filter((c) => c != null && sinAcentos(c) === sinAcentos(CATEGORIA_DIDI)).length;
  return didi > 0 && didi < categorias.length;
}

/** Código de origen a partir del código de plataforma de la integración ("didi", "uber"...). */
export function origenDePlataforma(plataforma: string | null | undefined): CodigoOrigen | null {
  switch (String(plataforma ?? "").trim().toLowerCase()) {
    case "didi": return "DIDI";
    case "uber": return "UBER";
    case "rappi": return "RAPPI";
    default: return null;
  }
}

const ETIQUETAS: Record<CodigoOrigen, string> = { DIDI: "DiDi Food", UBER: "Uber Eats", RAPPI: "Rappi" };

/** Rótulo del corte y los reportes; null/desconocido = mostrador. */
export function etiquetaOrigen(origen: string | null | undefined): string {
  return ETIQUETAS[origen as CodigoOrigen] ?? "Mostrador";
}
