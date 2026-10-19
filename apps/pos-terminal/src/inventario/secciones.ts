/**
 * Secciones físicas para el conteo de inventario: dónde está cada insumo en la sucursal
 * ("Exhibidor", "Refrigerador 1"…), para contar por zona y no buscando en una sola lista.
 *
 * Funciones puras (sin I/O) para poder probarlas con Jest; la persistencia y la cola están en
 * db/seccionesRepo.ts.
 */

export interface SeccionInventario {
  id: string;
  nombre: string;
  orden: number;
  activo: boolean;
}

/** Las secciones con las que arranca cada sucursal. Se pueden renombrar, quitar o agregar más. */
export const SECCIONES_INICIALES = [
  { clave: "exhibidor", nombre: "Exhibidor", orden: 1 },
  { clave: "refrigerador-1", nombre: "Refrigerador 1", orden: 2 },
  { clave: "refrigerador-2", nombre: "Refrigerador 2", orden: 3 },
  { clave: "tras-barra", nombre: "Tras barra", orden: 4 },
] as const;

export type ClaveSeccionInicial = (typeof SECCIONES_INICIALES)[number]["clave"];

/** Id determinista de una sección de inicio: dos tablets de la misma sucursal que las siembran
 *  sin conexión generan las MISMAS, y el ERP las une en vez de duplicarlas. */
export function idSeccionInicial(sucursalId: string, clave: ClaveSeccionInicial): string {
  return `seccion-${sucursalId}-${clave}`;
}

const normalizar = (s: string) =>
  s.normalize("NFD").replace(/\p{Mn}+/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Reglas para proponer la sección por el nombre del insumo, en ORDEN: la primera que coincide
 * gana. Refrigerador 1 va antes que Refrigerador 2 porque "dulce de leche" contiene "leche", y
 * antes que Tras barra porque "blue matcha" contiene "matcha".
 */
const REGLAS: { clave: ClaveSeccionInicial; palabras: string[] }[] = [
  { clave: "refrigerador-1", palabras: ["dulce de leche", "cajeta", "blue matcha", "cold brew", "mantequilla"] },
  { clave: "refrigerador-2", palabras: ["leche", "deslactosada", "almendra", "avena", "lala", "half and half", "crema para batir"] },
  {
    clave: "exhibidor",
    palabras: ["galleta", "cookie", "postre", "muffin", "brownie", "strudel", "rol de canela", "roles", "pastel", "cake", "pan ", "panque", "croissant", "dona", "bollo", "chunky"],
  },
  {
    clave: "tras-barra",
    palabras: [
      "vaso", "tapa", "popote", "servilleta", "agitador", "manga", "bolsa", "garrafon", "agua",
      "cafe", "grano", "espresso", "matcha", "chai", "cacao", "chocolate en polvo", "azucar", "splenda",
      "stevia", "jarabe", "sirope", "salsa", "canela", "te ", "tisana", "harina", "polvo",
    ],
  },
];

/** Una palabra con espacio al final ("pan ", "te ") solo cuenta como palabra completa, para que no
 *  case dentro de otras ("pantalla", "chocolate"); las demás cuentan en cualquier posición, así
 *  cubren plurales y compuestos ("galletas", "vasos 12 oz"). `n` llega rodeado de espacios. */
function coincide(n: string, palabra: string): boolean {
  return palabra.endsWith(" ") ? n.includes(` ${palabra}`) : n.includes(palabra);
}

/** Sección de inicio que corresponde a un insumo por su nombre, o null si ninguna regla aplica. */
export function seccionSugerida(nombreInsumo: string): ClaveSeccionInicial | null {
  const n = ` ${normalizar(nombreInsumo)} `;
  return REGLAS.find((regla) => regla.palabras.some((p) => coincide(n, p)))?.clave ?? null;
}

/**
 * En qué sección cae un insumo en esta sucursal:
 *  - si alguien lo asignó a mano, esa (o "sin sección" si se eligió así o la sección se dio de baja);
 *  - si no, la que propone su nombre, siempre que esa sección de inicio siga activa.
 * Devuelve el id de la sección, o null = sin sección.
 */
export function seccionDeInsumo(
  insumo: { insumoId: string; nombre: string },
  asignaciones: Map<string, string | null>,
  secciones: SeccionInventario[],
  sucursalId: string,
): string | null {
  const activas = new Set(secciones.filter((s) => s.activo).map((s) => s.id));
  if (asignaciones.has(insumo.insumoId)) {
    const elegida = asignaciones.get(insumo.insumoId) ?? null;
    return elegida && activas.has(elegida) ? elegida : null;
  }
  const clave = seccionSugerida(insumo.nombre);
  if (!clave) return null;
  const id = idSeccionInicial(sucursalId, clave);
  return activas.has(id) ? id : null;
}
