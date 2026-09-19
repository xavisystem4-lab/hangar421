/** Normalización de texto para el buscador del POS — función pura, sin dependencias (se prueba
 *  en busqueda.spec.ts).
 *
 *  A propósito NO usa String.prototype.normalize("NFD"): Hermes (el motor JS de React Native)
 *  no garantiza el soporte de normalización Unicode en todas las versiones, y un throw aquí
 *  reventaría la pantalla de venta. El catálogo real necesita plegar acentos de verdad —
 *  "Bebidas frías", "Café de bebé", "Roles de Canela by Törtchen" — así que se pliegan con una
 *  tabla explícita, que además cubre la diéresis alemana del proveedor de los roles. */
const EQUIVALENCIAS: Record<string, string> = {
  á: "a", à: "a", ä: "a", â: "a", ã: "a",
  é: "e", è: "e", ë: "e", ê: "e",
  í: "i", ì: "i", ï: "i", î: "i",
  ó: "o", ò: "o", ö: "o", ô: "o", õ: "o",
  ú: "u", ù: "u", ü: "u", û: "u",
  ñ: "n", ç: "c",
};

export function normalizarTexto(texto: string): string {
  let resultado = "";
  for (const caracter of texto.toLowerCase()) {
    resultado += EQUIVALENCIAS[caracter] ?? caracter;
  }
  return resultado;
}

/** true si `texto` contiene `termino`, ignorando mayúsculas y acentos. Un término vacío (o solo
 *  espacios) coincide con todo — así la pantalla de venta no necesita un caso especial para
 *  "sin búsqueda". */
export function coincideBusqueda(texto: string, termino: string): boolean {
  const buscado = normalizarTexto(termino.trim());
  if (!buscado) return true;
  return normalizarTexto(texto).includes(buscado);
}

/** Slug estable a partir de un texto libre — se usa para derivar los ids del catálogo local
 *  (ver catalogoHangar.ts). Debe ser determinista: los ids se recalculan en cada arranque y
 *  tienen que caer siempre en la misma fila. */
export function generarSlug(texto: string): string {
  return normalizarTexto(texto)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
