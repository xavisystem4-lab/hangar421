export type Tema = "claro" | "oscuro";

/** Colores de marca (acento) — no cambian entre temas, igual que en el POS Windows
 *  (`apps/pos-desktop/src/theme.css`: "los colores de acento se mantienen iguales en ambos
 *  modos — son color de marca, no de superficie"). */
const marca = {
  navy: "#0B1E33",
  amber: "#E8A33D",
  green: "#1F9D55",
  blue: "#2563EB",
  yellow: "#F5A524",
  red: "#DC2626",
};

/** Tokens de SUPERFICIE/TEXTO — estos sí cambian entre claro/oscuro. `superficie` es el fondo
 *  de tarjetas/modales/inputs (antes hardcodeado como "#fff" en cada pantalla); `fondo` es el
 *  fondo de la pantalla completa; `borde` los separadores; `texto`/`textoSecundario` el texto. */
const coloresClaro = {
  ...marca,
  black: "#111318",
  white: "#FFFFFF",
  gray50: "#F6F7F8",
  gray200: "#E5E7EB",
  gray400: "#9CA3AF",
  superficie: "#FFFFFF",
  fondo: "#F6F7F8",
  borde: "#E5E7EB",
  texto: "#111318",
  textoSecundario: "#9CA3AF",
  // "navy" como TEXTO (precios, totales, tab activo) sobre una superficie que cambia con el
  // tema — en claro es idéntico al navy de marca; en oscuro se aclara para seguir contrastando
  // sobre superficies oscuras (si no, texto navy oscuro sobre tarjeta oscura es ilegible). Mismo
  // criterio que --h421-navy-texto en el POS Windows (apps/pos-desktop/src/theme.css).
  navyTexto: "#0B1E33",
};

const coloresOscuro = {
  ...marca,
  black: "#E8EBF0",
  white: "#1A212C",
  gray50: "#10141C",
  gray200: "#2B3444",
  gray400: "#8B95A8",
  superficie: "#1A212C",
  fondo: "#10141C",
  borde: "#2B3444",
  texto: "#E8EBF0",
  textoSecundario: "#8B95A8",
  navyTexto: "#8FB4E0",
};

export type Paleta = typeof coloresClaro;

export function paleta(tema: Tema): Paleta {
  return tema === "oscuro" ? coloresOscuro : coloresClaro;
}

/** @deprecated usar `usarColores()` (src/store/temaStore.ts) para que la pantalla responda al
 *  cambio de tema — se deja la paleta clara como valor fijo solo para lo que aún no migró. */
export const colores = coloresClaro;
