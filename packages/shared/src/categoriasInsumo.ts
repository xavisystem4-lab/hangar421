/**
 * Sección de un insumo para buscarlo rápido (ERP → Inventario, Catálogo → Receta y la APK).
 *
 * No se guarda en la base: sale del nombre, que en Hangar ya sigue la costumbre
 * "Sección - Nombre" ("Limpieza - Pinol", "Plásticos - Vasos de cartón"). Lo que no trae prefijo
 * se clasifica por palabras clave ("Leche-Avena" → Leches, "Jarabe-Datil" → Jarabes y mieles).
 * Así cualquier insumo nuevo cae solo en su sección sin capturar nada más.
 */
export const SECCIONES_INSUMO = [
  "Preparaciones",
  "Café",
  "Leches",
  "Jarabes y mieles",
  "Polvos",
  "Bebidas y refreshers",
  "Postres",
  "Cocina",
  "Desechables",
  "Delivery",
  "Limpieza",
  "Otros",
] as const;

export type SeccionInsumo = (typeof SECCIONES_INSUMO)[number];

function sinAcentos(t: string): string {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

const POR_PREFIJO: Record<string, SeccionInsumo> = {
  delivery: "Delivery",
  limpieza: "Limpieza",
  plasticos: "Desechables",
  desechables: "Desechables",
  polvos: "Polvos",
  polvo: "Polvos",
  refreshers: "Bebidas y refreshers",
  refresher: "Bebidas y refreshers",
  postres: "Postres",
  postre: "Postres",
  jarabes: "Jarabes y mieles",
  jarabe: "Jarabes y mieles",
  leche: "Leches",
  leches: "Leches",
  cafe: "Café",
  cocina: "Cocina",
};

/** Orden importa: la primera regla que coincide gana. */
const POR_PALABRA: [RegExp, SeccionInsumo][] = [
  [/\bto\s*-\s*go\b|vaso|tapa|popote|manga|servilleta|agitador|palito|portavaso|papel encerado|cajas?\b|bolsa de cafe/, "Desechables"],
  [/^leche|\bleche\b(?!ra)/, "Leches"],
  [/jarabe|miel|cajeta|lechera|esencia|escencia/, "Jarabes y mieles"],
  [/^polvo|matcha|chai|cacao|nesquik|proteina|creatina|p\.?\s*spice/, "Polvos"],
  [/cafe|espresso|cold brew/, "Café"],
  [/\bagua\b|tonica|jugo|refresher|gasificada|hielo/, "Bebidas y refreshers"],
  [/muffin|brownie|galleta|cookie|pan de muerto|strudel|pastel|rol de|bombon|chocolate|sprinkles|pistache|cacahuate|crema/, "Postres"],
  [/pan\b|bagel|jamon|queso|aguacate|tomate|lechuga|pesto|mayonesa|limon|platano|semillas|sal\b|azucar|stevia|canela|datil/, "Cocina"],
];

export function seccionDeInsumo(insumo: { nombre: string; esPreparacion?: boolean | null }): SeccionInsumo {
  if (insumo.esPreparacion) return "Preparaciones";
  const nombre = sinAcentos(insumo.nombre ?? "");
  // "Sección - Nombre" o "Sección-Nombre": se toma lo de antes del primer guion.
  const m = nombre.match(/^([a-z ]+?)\s*-\s*\S/);
  if (m) {
    const prefijo = m[1].trim();
    if (POR_PREFIJO[prefijo]) return POR_PREFIJO[prefijo];
    // "Insumos - Crema para batir": el prefijo genérico no dice nada, decide el resto.
  }
  for (const [re, seccion] of POR_PALABRA) if (re.test(nombre)) return seccion;
  return "Otros";
}

/** Agrupa en el orden de SECCIONES_INSUMO, solo las secciones con algo, cada una por nombre. */
export function agruparPorSeccion<T extends { nombre: string; esPreparacion?: boolean | null }>(
  insumos: T[],
): { seccion: SeccionInsumo; items: T[] }[] {
  const mapa = new Map<SeccionInsumo, T[]>();
  for (const i of insumos) {
    const s = seccionDeInsumo(i);
    if (!mapa.has(s)) mapa.set(s, []);
    mapa.get(s)!.push(i);
  }
  return SECCIONES_INSUMO.filter((s) => mapa.has(s)).map((s) => ({
    seccion: s,
    items: mapa.get(s)!.sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
  }));
}
