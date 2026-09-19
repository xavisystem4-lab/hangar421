import type { SQLiteDatabase } from "expo-sqlite";

export interface CategoriaLocal {
  id: string;
  nombre: string;
  orden: number;
}

export interface ProductoLocal {
  id: string;
  categoriaId: string;
  nombre: string;
  /** Agrupador dentro de la categoría ("Galletas by Domingo"), o null si el producto no lo usa. */
  subcategoria: string | null;
  precioBase: number;
  orden: number;
  activo: boolean;
  /** Si es true, tocar la tarjeta abre el modal de modificadores en vez de agregar directo. */
  requierePersonalizacion: boolean;
}

export interface OpcionModificadorLocal {
  id: string;
  nombre: string;
  precioExtra: number;
  orden: number;
}

export interface ModificadorLocal {
  id: string;
  nombre: string;
  tipo: "SELECCION_UNICA" | "MULTIPLE";
  obligatorio: boolean;
  opciones: OpcionModificadorLocal[];
}

export async function listarCategorias(db: SQLiteDatabase): Promise<CategoriaLocal[]> {
  const filas = await db.getAllAsync<any>("SELECT id, nombre, orden FROM categorias_producto WHERE activo = 1 ORDER BY orden, nombre");
  return filas.map((f) => ({ id: f.id, nombre: f.nombre, orden: f.orden }));
}

/** Ordenado por `orden` (el del catálogo, igual que en el POS de Windows) y solo alfabético como
 *  desempate — antes era alfabético puro, que mezclaba el menú sin razón. */
export async function listarProductos(db: SQLiteDatabase): Promise<ProductoLocal[]> {
  const filas = await db.getAllAsync<any>(
    "SELECT id, categoria_id, nombre, subcategoria, precio_base, orden, activo, requiere_personalizacion FROM productos WHERE activo = 1 ORDER BY orden, nombre",
  );
  return filas.map((f) => ({
    id: f.id,
    categoriaId: f.categoria_id,
    nombre: f.nombre,
    subcategoria: f.subcategoria ?? null,
    precioBase: f.precio_base,
    orden: f.orden ?? 0,
    activo: !!f.activo,
    requierePersonalizacion: !!f.requiere_personalizacion,
  }));
}

/** Modificadores que pregunta un producto, con sus opciones, listos para el modal. Dos consultas
 *  en vez de un JOIN con agrupado a mano: son pocas filas y así el mapeo no tiene que deshacer
 *  el producto cartesiano. */
export async function modificadoresDeProducto(db: SQLiteDatabase, productoId: string): Promise<ModificadorLocal[]> {
  const mods = await db.getAllAsync<any>(
    `SELECT m.id, m.nombre, m.tipo, m.obligatorio
     FROM producto_modificadores pm JOIN modificadores m ON m.id = pm.modificador_id
     WHERE pm.producto_id = ? AND m.activo = 1
     ORDER BY pm.orden`,
    productoId,
  );
  if (mods.length === 0) return [];

  const marcadores = mods.map(() => "?").join(",");
  const opciones = await db.getAllAsync<any>(
    `SELECT id, modificador_id, nombre, precio_extra, orden FROM opciones_modificador
     WHERE modificador_id IN (${marcadores}) ORDER BY orden, nombre`,
    ...mods.map((m) => m.id),
  );

  return mods.map((m) => ({
    id: m.id,
    nombre: m.nombre,
    tipo: m.tipo,
    obligatorio: !!m.obligatorio,
    opciones: opciones
      .filter((o) => o.modificador_id === m.id)
      .map((o) => ({ id: o.id, nombre: o.nombre, precioExtra: o.precio_extra, orden: o.orden })),
  }));
}
