/**
 * Color de cada categoría del menú, para que el cajero reconozca de un vistazo los botones de
 * categoría y los de sus productos (azul rey = bebidas frías, rojo = calientes, café = postres…).
 *
 * Lógica pura (sin React Native) para poder probarla bajo Jest. El color sale del NOMBRE de la
 * categoría: así funciona en todas las sucursales sin tocar el ERP ni la base local, y una
 * categoría nueva con un nombre que no se reconoce recibe uno de la paleta de respaldo por su
 * posición, estable mientras no cambie el orden del catálogo.
 *
 * Todos los fondos son oscuros/saturados a propósito: el texto va siempre en blanco, con buen
 * contraste tanto en modo claro como en modo oscuro.
 */
export interface ColorCategoria {
  fondo: string;
  texto: string;
}

const BLANCO = "#FFFFFF";

/** Reglas por nombre, en orden: gana la primera que coincida. Las más específicas van antes
 *  ("frío/caliente" antes que "bebida" a secas). */
const REGLAS: { patron: RegExp; fondo: string }[] = [
  { patron: /fr[ií][ao]s?\b|hielo|frapp|smoothie|malteada|iced|cold/, fondo: "#1E40AF" }, // azul rey — bebidas frías
  { patron: /calient|caf[eé]s?\b|espresso|latte|t[eé]s?\b|infusi|hot/, fondo: "#C62828" }, // rojo — bebidas calientes
  { patron: /postre|pastel|repost|galleta|dulce|pay\b|brownie|cheesecake|helado/, fondo: "#6D4C41" }, // café — postres
  { patron: /didi|rappi|uber|plataforma|deliver/, fondo: "#E65100" }, // naranja — plataformas
  { patron: /combo|paquete|promo/, fondo: "#2E7D32" }, // verde — combos
  { patron: /temporada|especial|edici[oó]n/, fondo: "#6A1B9A" }, // morado — de temporada
  { patron: /desayun|brunch|huevo/, fondo: "#F59E0B" }, // ámbar — desayunos
  { patron: /bagel|pan\b|panader|sandwich|s[aá]ndwich|baguette|torta|hamburg|bocadillo|alimento|comida|cocina|platillo/, fondo: "#B45309" }, // naranja quemado — alimentos
  { patron: /snack|botana|papas|fruta/, fondo: "#00838F" }, // teal — snacks
  { patron: /bebida|refresco|soda|agua|jugo/, fondo: "#0277BD" }, // azul — bebidas en general
  { patron: /extra|adicional|modificador|topping/, fondo: "#546E7A" }, // gris azulado — extras
];

/** Paleta de respaldo para nombres no reconocidos; se recorre por posición. */
const PALETA = ["#1565C0", "#AD1457", "#00695C", "#4527A0", "#EF6C00", "#283593", "#558B2F", "#8E24AA", "#D84315", "#00838F"];

function normalizar(nombre: string): string {
  return nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Color para la categoría `nombre`; `indice` es su posición en el catálogo (para el respaldo). */
export function colorDeCategoria(nombre: string, indice = 0): ColorCategoria {
  const n = normalizar(nombre ?? "");
  // Los patrones están escritos sin acentos salvo donde se admiten ambas formas; se comparan
  // contra el nombre ya normalizado.
  for (const regla of REGLAS) {
    if (regla.patron.test(n)) return { fondo: regla.fondo, texto: BLANCO };
  }
  const i = ((indice % PALETA.length) + PALETA.length) % PALETA.length;
  return { fondo: PALETA[i], texto: BLANCO };
}

/** Mapa id → color para todas las categorías de una vez (misma regla para botones y productos). */
export function coloresPorCategoria<T extends { id: string; nombre: string }>(categorias: T[]): Map<string, ColorCategoria> {
  const m = new Map<string, ColorCategoria>();
  categorias.forEach((c, i) => m.set(c.id, colorDeCategoria(c.nombre, i)));
  return m;
}

/** Versión atenuada del color (botón de categoría NO seleccionado): mismo tono, más transparente
 *  sobre el fondo de la pantalla, para que el seleccionado resalte sólido. */
export function conOpacidad(hex: string, opacidad: number): string {
  const alpha = Math.round(Math.min(1, Math.max(0, opacidad)) * 255).toString(16).padStart(2, "0").toUpperCase();
  return `${hex}${alpha}`;
}
