/** Paleta de píldoras de categoría, construida a partir de los colores del logotipo
 *  (azul marino + ámbar) y variaciones sobrias del mismo espíritu "elegante industrial" —
 *  en vez de colores saturados sin relación entre sí. Se asigna por índice y se repite
 *  si hay más categorías que colores. */
export const CATEGORIA_COLORES = [
  "#e8a33d", // Café — ámbar del logo
  "#0b1e33", // Bebidas frías — azul marino del logo
  "#c97c4b", // Panadería — terracota cálido
  "#5b7a63", // Desayunos — verde salvia apagado
  "#a4472f", // Comidas — óxido/ladrillo
  "#6d5875", // Postres — ciruela apagado
  "#48586b", // Extras — gris pizarra azulado
];

/** Devuelve el color de texto (blanco o azul marino) con mejor contraste sobre un fondo
 *  hex dado, según su luminancia percibida — así cada píldora se lee bien sin tener que
 *  fijar el color de letra a mano por categoría. */
export function colorTextoContraste(hexFondo: string): string {
  const r = parseInt(hexFondo.slice(1, 3), 16);
  const g = parseInt(hexFondo.slice(3, 5), 16);
  const b = parseInt(hexFondo.slice(5, 7), 16);
  const luminancia = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminancia > 0.6 ? "#0b1e33" : "#ffffff";
}
