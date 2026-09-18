import type { SQLiteDatabase } from "expo-sqlite";
import { uuid7, SyncEntidad, SyncOperacion } from "@hangar421/shared";
import { encolarSync } from "./outboxRepo";
import { obtenerOCrearDispositivoId, obtenerOCrearSucursalIdLocal } from "./dispositivoLocal";

/** Alta/edición de catálogo LOCAL. Editar precio/disponibilidad de un producto que YA vino del
 *  ERP sí sincroniza (`SyncEntidad.PRODUCTO_SUCURSAL`, resuelto en `sync.service.ts::enrutar()`).
 *  Crear un producto o categoría COMPLETAMENTE NUEVO sigue siendo local-only a propósito: no
 *  existe (ni debería inventarse aquí) una ruta de sync para dar de alta un `Producto` entero —
 *  eso requiere `empresaId`/`categoriaId` válidos del lado del ERP y es, en esencia, el mismo
 *  flujo que ya cubre crm-web. `synced_at IS NULL` marca qué filas quedan "solo locales" hasta
 *  que el ERP las traiga de vuelta por `/sync/pull` (si alguien las da de alta allá también) o
 *  se resuelva ese gap de verdad. */

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

/** El nombre se edita local únicamente (no hay ruta de sync para renombrar un Producto, solo
 *  para su precio/disponibilidad por sucursal) — el precio SÍ se encola como PRODUCTO_SUCURSAL.
 *  Si `id` es de un producto creado aquí mismo (nunca sincronizado), el push fallará server-side
 *  con "producto no encontrado" y quedará en ERROR — esperado, no silenciosamente incorrecto. */
export async function editarProducto(db: SQLiteDatabase, id: string, datos: { nombre: string; precioBase: number }, usuarioId: string): Promise<void> {
  await db.runAsync("UPDATE productos SET nombre = ?, precio_base = ?, synced_at = NULL WHERE id = ?", datos.nombre, datos.precioBase, id);
  const [sucursalId, dispositivoId] = await Promise.all([obtenerOCrearSucursalIdLocal(db), obtenerOCrearDispositivoId(db)]);
  await encolarSync(db, {
    entidad: SyncEntidad.PRODUCTO_SUCURSAL,
    operacion: SyncOperacion.UPDATE,
    entidadId: id,
    sucursalId,
    dispositivoId,
    usuarioId,
    payload: { productoId: id, precio: datos.precioBase },
  });
}

export async function alternarDisponibilidadProducto(db: SQLiteDatabase, id: string, activo: boolean, usuarioId: string): Promise<void> {
  await db.runAsync("UPDATE productos SET activo = ?, synced_at = NULL WHERE id = ?", activo ? 1 : 0, id);
  const [sucursalId, dispositivoId] = await Promise.all([obtenerOCrearSucursalIdLocal(db), obtenerOCrearDispositivoId(db)]);
  await encolarSync(db, {
    entidad: SyncEntidad.PRODUCTO_SUCURSAL,
    operacion: SyncOperacion.UPDATE,
    entidadId: id,
    sucursalId,
    dispositivoId,
    usuarioId,
    payload: { productoId: id, disponible: activo },
  });
}

/** Productos/categorías creados o editados aquí (nunca sincronizados) — para mostrar el aviso
 *  "cambios solo locales" en la pantalla de admin. */
export async function contarCambiosSoloLocales(db: SQLiteDatabase): Promise<number> {
  const fila = await db.getFirstAsync<{ total: number }>(
    "SELECT (SELECT COUNT(*) FROM productos WHERE synced_at IS NULL) + (SELECT COUNT(*) FROM categorias_producto WHERE synced_at IS NULL) AS total",
  );
  return fila?.total ?? 0;
}
