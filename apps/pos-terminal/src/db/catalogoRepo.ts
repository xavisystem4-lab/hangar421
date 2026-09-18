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
  precioBase: number;
  activo: boolean;
}

export async function listarCategorias(db: SQLiteDatabase): Promise<CategoriaLocal[]> {
  const filas = await db.getAllAsync<any>("SELECT id, nombre, orden FROM categorias_producto WHERE activo = 1 ORDER BY orden, nombre");
  return filas.map((f) => ({ id: f.id, nombre: f.nombre, orden: f.orden }));
}

export async function listarProductos(db: SQLiteDatabase): Promise<ProductoLocal[]> {
  const filas = await db.getAllAsync<any>("SELECT id, categoria_id, nombre, precio_base, activo FROM productos WHERE activo = 1 ORDER BY nombre");
  return filas.map((f) => ({ id: f.id, categoriaId: f.categoria_id, nombre: f.nombre, precioBase: f.precio_base, activo: !!f.activo }));
}
