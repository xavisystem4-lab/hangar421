/** Paleta de píldoras de categoría (estilo referencia): un color vivo por categoría,
 *  se asigna por índice y se repite si hay más categorías que colores. Colores en hex
 *  (no `var(--...)`) porque se combinan con un canal alfa para el estado inactivo
 *  (`${color}1f`) — debe coincidir con las variables --h421-cat-* de theme.css. */
export const CATEGORIA_COLORES = [
  "#f5a524", // Café — ámbar
  "#2563eb", // Bebidas frías — azul
  "#e8734d", // Panadería — naranja
  "#16a34a", // Desayunos — verde
  "#dc2626", // Comidas — rojo
  "#a855f7", // Postres — morado
  "#0d9488", // Extras — teal
];
