/** Alta de un grupo de modificadores desde la terminal (Admin → Catálogo): "Tamaño", "Tipo de
 *  leche", "Extras", "Jarabe"… con sus opciones y precio extra. Lógica pura para probarla con Jest
 *  (nuevoModificador.spec.ts); el guardado vive en db/catalogoAdminRepo.ts. */

export type TipoModificador = "SELECCION_UNICA" | "MULTIPLE";

/** Lo que el cajero escribe: los precios llegan como texto del teclado. */
export interface BorradorModificador {
  nombre: string;
  tipo: TipoModificador;
  obligatorio: boolean;
  opciones: { nombre: string; precio: string }[];
}

export interface ModificadorNuevo {
  nombre: string;
  tipo: TipoModificador;
  obligatorio: boolean;
  opciones: { nombre: string; precioExtra: number }[];
}

export type ResultadoValidacion = { ok: true; valor: ModificadorNuevo } | { ok: false; error: string };

const redondear = (n: number) => Math.round(n * 100) / 100;

/** Valida el borrador. Las filas totalmente vacías se ignoran (la pantalla siempre deja una en
 *  blanco al final); el precio vacío vale $0. `nombresExistentes` evita crear un grupo repetido. */
export function validarNuevoModificador(borrador: BorradorModificador, nombresExistentes: string[] = []): ResultadoValidacion {
  const nombre = borrador.nombre.trim().replace(/\s+/g, " ");
  if (!nombre) return { ok: false, error: "Escribe el nombre del modificador (por ejemplo: Tipo de leche)." };
  if (nombresExistentes.some((n) => n.trim().toLowerCase() === nombre.toLowerCase())) {
    return { ok: false, error: `Ya existe un modificador llamado "${nombre}". Elígelo de la lista o usa otro nombre.` };
  }

  const opciones: ModificadorNuevo["opciones"] = [];
  const vistos = new Set<string>();
  for (const fila of borrador.opciones) {
    const nombreOpcion = fila.nombre.trim().replace(/\s+/g, " ");
    const textoPrecio = fila.precio.trim().replace(",", ".").replace(/^\$/, "");
    if (!nombreOpcion && !textoPrecio) continue;
    if (!nombreOpcion) return { ok: false, error: "Una opción tiene precio pero no nombre." };
    const precio = textoPrecio === "" ? 0 : Number(textoPrecio);
    if (!Number.isFinite(precio) || precio < 0) return { ok: false, error: `El precio extra de "${nombreOpcion}" no es válido.` };
    const clave = nombreOpcion.toLowerCase();
    if (vistos.has(clave)) return { ok: false, error: `La opción "${nombreOpcion}" está repetida.` };
    vistos.add(clave);
    opciones.push({ nombre: nombreOpcion, precioExtra: redondear(precio) });
  }
  if (opciones.length === 0) return { ok: false, error: "Agrega al menos una opción (por ejemplo: Avena +$10)." };

  return { ok: true, valor: { nombre, tipo: borrador.tipo, obligatorio: borrador.obligatorio, opciones } };
}
