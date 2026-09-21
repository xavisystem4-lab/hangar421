/**
 * Emparejamiento de ids locales del POS con los de la nube. El catálogo y los usuarios locales
 * nacieron con ids propios (el backend embebido siembra su propio catálogo), pero con los mismos
 * nombres que la nube: se relacionan por nombre normalizado. Lo que no empareja queda sin
 * equivalente y lo relaciona el admin a mano; nunca se crea nada en la nube por esto.
 */

/** Minúsculas, sin acentos ni signos, espacios colapsados: "Café  Latte " = "cafe latte". */
export function normalizarNombre(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Elemento a emparejar. `grupos` va del más específico al más general (en productos:
 *  [categoría + subcategoría, categoría]); el nombre solo es el último recurso. */
export interface Emparejable {
  id: string;
  nombre: string;
  grupos?: (string | null | undefined)[];
}

/**
 * Para cada elemento local, el id de la nube que le corresponde, o null.
 *
 * Se prueba de lo más específico a lo más general: el catálogo repite nombres —"Latte" caliente y
 * "Latte" frío, dos "Pistache" en Postres que solo distingue la subcategoría— y emparejar solo por
 * nombre dejaría todos sin equivalente. En cada nivel solo cuenta un candidato ÚNICO en la nube;
 * lo que siga siendo ambiguo al final no se adivina: queda sin equivalente para que decida el admin.
 */
export function emparejarPorNombre(locales: Emparejable[], nube: Emparejable[]): Map<string, string | null> {
  const niveles = Math.max(0, ...[...locales, ...nube].map((e) => e.grupos?.length ?? 0));
  const clave = (e: Emparejable, nivel: number) => {
    const grupos = (e.grupos ?? []).slice(nivel).map((g) => normalizarNombre(g ?? ""));
    return [...grupos, normalizarNombre(e.nombre)].join("|");
  };
  // Un índice por nivel: 0 = todos los grupos, niveles = solo el nombre.
  const indices = Array.from({ length: niveles + 1 }, (_, nivel) => {
    const indice = new Map<string, string | null>();
    for (const n of nube) {
      const k = clave(n, nivel);
      indice.set(k, indice.has(k) ? null : n.id);
    }
    return indice;
  });
  return new Map(
    locales.map((l) => {
      for (let nivel = 0; nivel <= niveles; nivel++) {
        const id = indices[nivel].get(clave(l, nivel));
        if (id) return [l.id, id];
      }
      return [l.id, null];
    }),
  );
}

/** Clave de una opción de modificador: modificador + opción ("Leche|Avena"). */
export function claveOpcion(modificador: string, opcion: string): string {
  return `${normalizarNombre(modificador)}|${normalizarNombre(opcion)}`;
}
