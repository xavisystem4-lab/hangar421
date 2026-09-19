/** Lógica pura de releases — sin imports, para que sea testeable bajo Jest.
 *
 *  Vive separada de `updates.ts` a propósito: aquel importa `expo-constants`, un módulo nativo
 *  que Jest no puede cargar (mismo motivo por el que `catalogoHangar.ts` solo usa `import type`
 *  de expo-sqlite). Esta parte es justo la que conviene probar: comparar versiones y elegir el
 *  release correcto son las dos cosas que, si fallan, lo hacen en silencio. */

/** Tag con el que `release-pos-terminal.yml` publica los APK de ESTA app. En el mismo
 *  repositorio conviven el POS Windows (`vX.Y.Z`) y Meseros (`waiter-vX.Y.Z`); solo el prefijo
 *  los distingue. */
export const PREFIJO_TAG = "pos-terminal-v";

export function versionDeTag(tag: string): string {
  return tag.startsWith(PREFIJO_TAG) ? tag.slice(PREFIJO_TAG.length) : tag;
}

/** Compara "X.Y.Z" numéricamente, no alfabéticamente — "0.2.9" debe quedar por DEBAJO de
 *  "0.10.0", y como string sería al revés. */
export function esVersionMasNueva(candidata: string, actual: string): boolean {
  const a = candidata.split(".").map((n) => Number(n) || 0);
  const b = actual.split(".").map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

/** Elige el release más nuevo de ESTA app de entre los que devuelve GitHub.
 *
 *  No basta con tomar el primero del listado: la API los ordena por fecha, y aquí se publican
 *  tres apps distintas. Se filtra por prefijo y se ordena por VERSIÓN, no por fecha, para que un
 *  release republicado más tarde con versión menor no se cuele como "el último".
 *
 *  Se aceptan prerelease a propósito: los de esta app se publican siempre así (ver el comentario
 *  de release-pos-terminal.yml sobre el auto-actualizador del POS Windows), de modo que
 *  descartarlos dejaría la lista vacía y el botón diría "Al día" para siempre. */
export function elegirReleaseMasNuevo<T extends { tag_name: string; draft: boolean }>(releases: T[]): T | null {
  const propios = releases.filter((r) => !r.draft && r.tag_name?.startsWith(PREFIJO_TAG));
  if (propios.length === 0) return null;
  return propios.reduce((mejor, actual) =>
    esVersionMasNueva(versionDeTag(actual.tag_name), versionDeTag(mejor.tag_name)) ? actual : mejor,
  );
}
