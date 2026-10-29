/**
 * Cuánta leche lleva una bebida. La leche se descuenta por la OPCIÓN de "Tipo de leche" que eligió
 * el cliente (receta fija de 240 g), pero las hojas de receta cambian la cantidad según la bebida y
 * lo que se le agregó: un Iced Latte lleva 240 g, con cold foam 190 g, con cold foam y shot extra
 * 150 g. Aquí vive esa regla, igual para el ERP y para la tablet.
 */

/** Leche por bebida, en gramos. `base` null = la bebida no la define y se usa la receta de la opción. */
export interface LecheDeProducto {
  base: number | null;
  conColdFoam?: number | null;
  conShot?: number | null;
  conAmbos?: number | null;
}

/** Opción elegida en el renglón, con el nombre de su grupo de modificador. */
export interface OpcionElegida {
  opcionModificadorId: string;
  grupo: string;
  opcion: string;
}

const NIEGA = /\bsin\b/i;

/** "Tipo de leche", "Tipo de leche (DiDi)". */
export function esGrupoDeLeche(grupo: string): boolean {
  return /leche/i.test(grupo);
}

/** Cualquier opción del grupo "Cold Foam", o una opción que diga "cold foam" (no "sin cold foam"). */
export function esColdFoam(o: Pick<OpcionElegida, "grupo" | "opcion">): boolean {
  if (NIEGA.test(o.opcion)) return false;
  return /cold\s*foam/i.test(o.grupo) || /cold\s*foam/i.test(o.opcion);
}

/** "Shot extra", "Shot de espresso" (no "sin shot"). */
export function esShot(o: Pick<OpcionElegida, "opcion">): boolean {
  return /shot/i.test(o.opcion) && !NIEGA.test(o.opcion);
}

function valido(n: number | null | undefined): number | null {
  const v = n === null || n === undefined ? NaN : Number(n);
  return Number.isFinite(v) && v >= 0 ? v : null;
}

/**
 * Gramos de leche de la bebida. Si un caso no está capturado se cae al más parecido:
 * ambos → con cold foam → con shot → base.
 */
export function gramosDeLeche(leche: LecheDeProducto, extras: { coldFoam: boolean; shot: boolean }): number | null {
  const base = valido(leche.base);
  if (base === null) return null;
  const cf = valido(leche.conColdFoam);
  const sh = valido(leche.conShot);
  if (extras.coldFoam && extras.shot) return valido(leche.conAmbos) ?? cf ?? sh ?? base;
  if (extras.coldFoam) return cf ?? base;
  if (extras.shot) return sh ?? base;
  return base;
}

/** Ajuste de leche de un renglón (lo que recibe consumoDeVenta). */
export interface AjusteLeche {
  gramos: number;
  /** Opciones elegidas que son la leche; vacío si no eligieron ninguna. */
  opcionIds: string[];
  /** Sin leche elegida: insumo que se descuenta por omisión (la leche entera). */
  insumoPorOmision?: string;
}

/**
 * Ajuste de leche de un renglón: los gramos y qué opciones elegidas son la leche. null = no hay
 * nada que ajustar (la bebida no define leche).
 *
 * Si la bebida lleva leche pero NO eligieron ninguna (pedidos de DiDi que llegan sin opciones, o
 * un Latte al que solo le pusieron el tamaño), antes no se descontaba nada y la leche "se
 * perdía" del inventario. Con `insumoPorOmision` (la leche entera, ver lechePorOmision) se
 * descuentan los gramos de la bebida de esa leche.
 */
export function ajusteDeLeche(
  leche: LecheDeProducto | null | undefined,
  opciones: OpcionElegida[],
  insumoPorOmision?: string | null,
): AjusteLeche | null {
  if (!leche) return null;
  const opcionIds = opciones.filter((o) => esGrupoDeLeche(o.grupo)).map((o) => o.opcionModificadorId);
  if (opcionIds.length === 0 && !insumoPorOmision) return null;
  const gramos = gramosDeLeche(leche, { coldFoam: opciones.some(esColdFoam), shot: opciones.some(esShot) });
  if (gramos === null) return null;
  return opcionIds.length > 0 ? { gramos, opcionIds } : { gramos, opcionIds: [], insumoPorOmision: insumoPorOmision! };
}

/**
 * Leche que se descuenta cuando una bebida con leche se vende sin elegir una: la opción "Entera"
 * de un grupo de leche, y de su receta la línea principal (la de más cantidad: la leche).
 * null si el catálogo no tiene una leche entera con receta.
 */
export function lechePorOmision(
  opcionesConReceta: { grupo: string; opcion: string; receta: { insumoId: string; cantidad: number }[] }[],
): string | null {
  const candidatas = opcionesConReceta.filter((o) => esGrupoDeLeche(o.grupo) && /entera/i.test(o.opcion) && o.receta.length > 0);
  // La más común entre los grupos de leche (Tipo de leche, Tipo de leche (DiDi)…).
  const votos = new Map<string, number>();
  for (const o of candidatas) {
    const principal = o.receta.reduce((a, b) => (Number(b.cantidad) > Number(a.cantidad) ? b : a));
    votos.set(principal.insumoId, (votos.get(principal.insumoId) ?? 0) + 1);
  }
  let mejor: string | null = null;
  for (const [id, n] of votos) if (!mejor || n > (votos.get(mejor) ?? 0)) mejor = id;
  return mejor;
}
