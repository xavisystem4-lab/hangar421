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
}

export async function listarCategorias(db: SQLiteDatabase): Promise<CategoriaLocal[]> {
  const filas = await db.getAllAsync<any>("SELECT id, nombre, orden FROM categorias_producto WHERE activo = 1 ORDER BY orden, nombre");
  return filas.map((f) => ({ id: f.id, nombre: f.nombre, orden: f.orden }));
}

/** Ordenado por `orden` (el del catálogo, igual que en el POS de Windows) y solo alfabético como
 *  desempate — antes era alfabético puro, que mezclaba el menú sin razón. */
export async function listarProductos(db: SQLiteDatabase): Promise<ProductoLocal[]> {
  const filas = await db.getAllAsync<any>(
    "SELECT id, categoria_id, nombre, subcategoria, precio_base, orden, activo FROM productos WHERE activo = 1 ORDER BY orden, nombre",
  );
  return filas.map((f) => ({
    id: f.id,
    categoriaId: f.categoria_id,
    nombre: f.nombre,
    subcategoria: f.subcategoria ?? null,
    precioBase: f.precio_base,
    orden: f.orden ?? 0,
    activo: !!f.activo,
  }));
}
