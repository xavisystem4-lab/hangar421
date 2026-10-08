/** Alta y edición de insumos desde la terminal — validación pura, sin imports, para poder
 *  probarla. La llamada al ERP vive en `insumosApi.ts`; aquí solo se decide si lo capturado es
 *  válido y qué se manda. */

/** Mismas unidades que ofrece el ERP web (`crm-web/.../inventario`), para no crear insumos con
 *  una unidad que el resto del sistema no reconoce. */
export const UNIDADES_INSUMO = ["pz", "g", "kg", "ml", "l"] as const;
export type UnidadInsumo = (typeof UNIDADES_INSUMO)[number];

/** Lo que se teclea en el formulario: todo texto, tal cual lo deja el TextInput. */
export interface BorradorInsumo {
  nombre: string;
  unidadMedida: string;
  costoUnitario: string;
  proveedorId: string;
  minimo: string;
  maximo: string;
}

export const BORRADOR_VACIO: BorradorInsumo = {
  nombre: "", unidadMedida: "pz", costoUnitario: "", proveedorId: "", minimo: "", maximo: "",
};

export interface InsumoValidado {
  nombre: string;
  unidadMedida: UnidadInsumo;
  costoUnitario: number;
  proveedorId: string | null;
  minimo: number | undefined;
  maximo: number | undefined;
}

export type ResultadoValidacion =
  | { ok: true; datos: InsumoValidado }
  | { ok: false; error: string };

/** Para comparar nombres sin que mayúsculas, acentos o espacios dobles creen duplicados
 *  ("Leche  entera" y "leche Entera" son el mismo insumo en el almacén). */
export function normalizarNombre(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Campo numérico opcional: vacío = no capturado; si se capturó tiene que ser un número ≥ 0. */
function numeroOpcional(texto: string): number | undefined | null {
  const t = texto.trim().replace(",", ".");
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Valida un insumo antes de mandarlo al ERP.
 *
 * El duplicado se busca contra TODA la lista de inventario (también contra los dados de baja):
 * dar de alta otra vez "Leche entera" crearía un segundo insumo con existencia propia, y el
 * stock del almacén quedaría partido en dos sin que nadie lo note. `idEditando` excluye al
 * propio insumo cuando se edita.
 */
export function validarInsumo(
  borrador: BorradorInsumo,
  existentes: { id: string; nombre: string }[],
  idEditando?: string,
): ResultadoValidacion {
  const nombre = borrador.nombre.replace(/\s+/g, " ").trim();
  if (nombre.length < 2) return { ok: false, error: "Escribe el nombre del insumo." };

  const clave = normalizarNombre(nombre);
  const repetido = existentes.find((e) => e.id !== idEditando && normalizarNombre(e.nombre) === clave);
  if (repetido) return { ok: false, error: `Ya existe un insumo llamado "${repetido.nombre}" en el inventario.` };

  if (!(UNIDADES_INSUMO as readonly string[]).includes(borrador.unidadMedida)) {
    return { ok: false, error: "Elige la unidad de medida." };
  }

  const costo = numeroOpcional(borrador.costoUnitario);
  if (costo === null) return { ok: false, error: "El costo debe ser un número mayor o igual a 0." };
  const minimo = numeroOpcional(borrador.minimo);
  if (minimo === null) return { ok: false, error: "El mínimo debe ser un número mayor o igual a 0." };
  const maximo = numeroOpcional(borrador.maximo);
  if (maximo === null) return { ok: false, error: "El máximo debe ser un número mayor o igual a 0." };
  if (minimo !== undefined && maximo !== undefined && maximo > 0 && maximo < minimo) {
    return { ok: false, error: "El máximo no puede ser menor que el mínimo." };
  }

  return {
    ok: true,
    datos: {
      nombre,
      unidadMedida: borrador.unidadMedida as UnidadInsumo,
      costoUnitario: costo ?? 0,
      proveedorId: borrador.proveedorId || null,
      minimo,
      maximo,
    },
  };
}
