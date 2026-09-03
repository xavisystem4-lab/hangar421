/** Paleta de píldoras de categoría, construida a partir de los colores del logotipo
 *  (azul marino + ámbar) y variaciones sobrias del mismo espíritu "elegante industrial" —
 *  en vez de colores saturados sin relación entre sí. Se asigna por índice y se repite
 *  si hay más categorías que colores. */
export const CATEGORIA_COLORES = [
  "#f2a92c", // Bebidas frías — ámbar vivo del logo
  "#132a47", // Bebidas calientes — azul marino vivo del logo
  "#e2703a", // Refresher — terracota vivo
  "#3f9c56", // Para llevar — verde vivo
  "#c8432e", // Postres — óxido/rojo ladrillo vivo
  "#8b4fa0", // Combos — morado ciruela vivo
  "#3d6b99", // Extras — azul acero vivo
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
