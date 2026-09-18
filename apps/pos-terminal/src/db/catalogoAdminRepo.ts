import type { SQLiteDatabase } from "expo-sqlite";
import { uuid7 } from "@hangar421/shared";

/** Alta/edición de catálogo LOCAL — a propósito sin salida por sync todavía (gap documentado,
 *  mismo criterio que el de movimientos de caja en turnosRepo.ts): `SyncEntidad.PRODUCTO_SUCURSAL`
 *  existe en el enum (packages/shared) pero `sync.service.ts::enrutar()` (backend) no tiene un
 *  caso para ella — solo la usa `pull()` (servidor→cliente). Encolarla en sync_outbox de todos
 *  modos sería peor que no encolarla: si el backend algún día procesa una entidad no reconocida
 *  sin lanzar error, el item quedaría marcado "SYNCED" sin que el servidor hiciera nada, y el
 *  indicador de sync mentiría. Mientras tanto: lo que se cree/edite aquí sirve para vender en
 *  ESTE dispositivo, pero no viaja al ERP hasta que exista esa ruta (y, para productos nuevos
 *  de verdad, un endpoint de creación — hoy solo existe edición de precio/disponibilidad por
 *  sucursal). `synced_at IS NULL` marca qué filas son "solo locales" para cuando se resuelva. */

export interface NuevaCategoria { nombre: string; orden?: number }
export interface NuevoProducto { categoriaId: string; nombre: string; precioBase: number }

export async function crearCategoria(db: SQLiteDatabase, datos: NuevaCategoria): Promise<string> {
  const id = uuid7();
  await db.runAsync(
    "INSERT INTO categorias_producto (id, nombre, orden, activo, updated_at_server, synced_at) VALUES (?, ?, ?, 1, NULL, NULL)",
    id, datos.nombre, datos.orden ?? 0,
  );
  return id;
}

export async function editarCategoria(db: SQLiteDatabase, id: string, nombre: string): Promise<void> {
  // synced_at = NULL: un producto/categoría que YA vino del ERP y se edita local queda marcado
  // "con cambios sin sincronizar" igual que uno creado enteramente aquí — mismo gap, mismo aviso.
  await db.runAsync("UPDATE categorias_producto SET nombre = ?, synced_at = NULL WHERE id = ?", nombre, id);
}

export async function desactivarCategoria(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync("UPDATE categorias_producto SET activo = 0 WHERE id = ?", id);
}

export async function crearProducto(db: SQLiteDatabase, datos: NuevoProducto): Promise<string> {
  const id = uuid7();
  await db.runAsync(
    "INSERT INTO productos (id, categoria_id, nombre, precio_base, tasa_impuesto, activo, updated_at_server, synced_at) VALUES (?, ?, ?, ?, 0, 1, NULL, NULL)",
    id, datos.categoriaId, datos.nombre, datos.precioBase,
  );
  return id;
}

export async function editarProducto(db: SQLiteDatabase, id: string, datos: { nombre: string; precioBase: number }): Promise<void> {
  await db.runAsync("UPDATE productos SET nombre = ?, precio_base = ?, synced_at = NULL WHERE id = ?", datos.nombre, datos.precioBase, id);
}

export async function alternarDisponibilidadProducto(db: SQLiteDatabase, id: string, activo: boolean): Promise<void> {
  await db.runAsync("UPDATE productos SET activo = ?, synced_at = NULL WHERE id = ?", activo ? 1 : 0, id);
}

/** Productos/categorías creados o editados aquí (nunca sincronizados) — para mostrar el aviso
 *  "cambios solo locales" en la pantalla de admin. */
export async function contarCambiosSoloLocales(db: SQLiteDatabase): Promise<number> {
  const fila = await db.getFirstAsync<{ total: number }>(
    "SELECT (SELECT COUNT(*) FROM productos WHERE synced_at IS NULL) + (SELECT COUNT(*) FROM categorias_producto WHERE synced_at IS NULL) AS total",
  );
  return fila?.total ?? 0;
}
