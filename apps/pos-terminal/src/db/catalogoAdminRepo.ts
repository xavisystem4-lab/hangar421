import type { SQLiteDatabase } from "expo-sqlite";
import { uuid7, SyncEntidad, SyncOperacion } from "@hangar421/shared";
import { encolarSync } from "./outboxRepo";
import { obtenerOCrearDispositivoId, obtenerOCrearSucursalIdLocal } from "./dispositivoLocal";
import type { ModificadorNuevo } from "../caja/nuevoModificador";

/** Alta/edición de catálogo desde la terminal.
 *
 *  - Precio/disponibilidad de un producto: `SyncEntidad.PRODUCTO_SUCURSAL` (por sucursal).
 *  - Alta de un producto, con los modificadores que debe preguntar: `SyncEntidad.PRODUCTO` /
 *    CREATE. Viaja con el mismo id que aquí; el ERP lo crea, lo pone en venta en esta sucursal
 *    y en standby en las demás (ver catalogo.service.ts::altaProductoDesdeTerminal). Cambiar los
 *    modificadores de un producto ya existente va como PRODUCTO / UPDATE.
 *  - Crear una CATEGORÍA nueva sigue siendo local-only: el ERP rechaza un producto cuya
 *    categoría no exista allá, así que un producto nuevo debe ir en una categoría que ya vino del
 *    ERP (la pantalla lo avisa).
 *  `synced_at IS NULL` marca lo que todavía no confirmó el ERP; el siguiente pull del catálogo
 *  trae el producto de vuelta con el mismo id y lo limpia. */

export interface NuevaCategoria { nombre: string; orden?: number }
export interface NuevoProducto {
  categoriaId: string;
  nombre: string;
  precioBase: number;
  /** Modificadores que preguntará al venderse, en el orden en que se eligieron. Vacío = se
   *  agrega directo al carrito. */
  modificadorIds?: string[];
}

/** Crea un grupo de modificadores (con sus opciones) en la terminal y lo manda al ERP como
 *  MODIFICADOR / CREATE con los mismos ids. Debe quedar en el outbox ANTES del producto que lo
 *  usa: el outbox se drena en orden, así que basta con crear el grupo primero (el modal lo hace
 *  al momento de guardarlo, no al crear el producto).
 *
 *  `origen = 'TERMINAL'` (no 'LOCAL'): 'LOCAL' es el catálogo sembrado del dispositivo y se
 *  retira en cuanto el ERP manda uno de verdad; un grupo creado a propósito aquí no debe
 *  desaparecer. Al sincronizar, el pull lo trae de vuelta con el mismo id y lo pasa a 'ERP'. */
export async function crearModificadorLocal(db: SQLiteDatabase, datos: ModificadorNuevo, usuarioId?: string): Promise<string> {
  const id = uuid7();
  const opciones = datos.opciones.map((o, i) => ({ id: uuid7(), nombre: o.nombre, precioExtra: o.precioExtra, orden: i + 1 }));
  const [sucursalId, dispositivoId] = await Promise.all([obtenerOCrearSucursalIdLocal(db), obtenerOCrearDispositivoId(db)]);
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      "INSERT INTO modificadores (id, nombre, tipo, obligatorio, activo, origen, synced_at) VALUES (?, ?, ?, ?, 1, 'TERMINAL', NULL)",
      id, datos.nombre, datos.tipo, datos.obligatorio ? 1 : 0,
    );
    for (const o of opciones) {
      await db.runAsync(
        "INSERT INTO opciones_modificador (id, modificador_id, nombre, precio_extra, orden) VALUES (?, ?, ?, ?, ?)",
        o.id, id, o.nombre, o.precioExtra, o.orden,
      );
    }
    await encolarSync(db, {
      entidad: SyncEntidad.MODIFICADOR,
      operacion: SyncOperacion.CREATE,
      entidadId: id,
      sucursalId,
      dispositivoId,
      usuarioId,
      payload: { nombre: datos.nombre, tipo: datos.tipo, obligatorio: datos.obligatorio, opciones },
    });
  });
  return id;
}

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

export async function crearProducto(db: SQLiteDatabase, datos: NuevoProducto, usuarioId?: string): Promise<string> {
  const id = uuid7();
  const modificadorIds = [...new Set(datos.modificadorIds ?? [])];
  const [sucursalId, dispositivoId] = await Promise.all([obtenerOCrearSucursalIdLocal(db), obtenerOCrearDispositivoId(db)]);
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      "INSERT INTO productos (id, categoria_id, nombre, precio_base, tasa_impuesto, activo, requiere_personalizacion, updated_at_server, synced_at) VALUES (?, ?, ?, ?, 0, 1, ?, NULL, NULL)",
      id, datos.categoriaId, datos.nombre, datos.precioBase, modificadorIds.length > 0 ? 1 : 0,
    );
    await guardarModificadoresLocales(db, id, modificadorIds);
    // En venta aquí desde ya (precios_sucursal es lo que aplicarPreciosDeSucursal relee al
    // cambiar de sucursal; sin la fila, el producto se perdería al reabrir sesión).
    await db.runAsync(
      "INSERT OR REPLACE INTO precios_sucursal (producto_id, sucursal_id, precio, disponible) VALUES (?, ?, ?, 1)",
      id, sucursalId, datos.precioBase,
    );
    await encolarSync(db, {
      entidad: SyncEntidad.PRODUCTO,
      operacion: SyncOperacion.CREATE,
      entidadId: id,
      sucursalId,
      dispositivoId,
      usuarioId,
      payload: { categoriaId: datos.categoriaId, nombre: datos.nombre, precioBase: datos.precioBase, modificadorIds },
    });
  });
  return id;
}

/** Cambia qué modificadores pregunta un producto (nuevo o del ERP). Reemplaza la lista local y
 *  la manda al ERP como PRODUCTO / UPDATE; `requiere_personalizacion` sigue a la lista para que
 *  el modal abra (o deje de abrir) en cuanto se guarda, sin esperar al siguiente pull. */
export async function fijarModificadoresDeProducto(db: SQLiteDatabase, productoId: string, modificadorIds: string[], usuarioId?: string): Promise<void> {
  const ids = [...new Set(modificadorIds)];
  const [sucursalId, dispositivoId] = await Promise.all([obtenerOCrearSucursalIdLocal(db), obtenerOCrearDispositivoId(db)]);
  await db.withTransactionAsync(async () => {
    await guardarModificadoresLocales(db, productoId, ids);
    await db.runAsync("UPDATE productos SET requiere_personalizacion = ?, synced_at = NULL WHERE id = ?", ids.length > 0 ? 1 : 0, productoId);
    await encolarSync(db, {
      entidad: SyncEntidad.PRODUCTO,
      operacion: SyncOperacion.UPDATE,
      entidadId: productoId,
      sucursalId,
      dispositivoId,
      usuarioId,
      payload: { modificadorIds: ids },
    });
  });
}

async function guardarModificadoresLocales(db: SQLiteDatabase, productoId: string, modificadorIds: string[]): Promise<void> {
  await db.runAsync("DELETE FROM producto_modificadores WHERE producto_id = ?", productoId);
  let orden = 1;
  for (const modificadorId of modificadorIds) {
    await db.runAsync("INSERT INTO producto_modificadores (producto_id, modificador_id, orden) VALUES (?, ?, ?)", productoId, modificadorId, orden++);
  }
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

/** En venta / en standby, para la sucursal activa. En standby el producto no sale en los
 *  botones de Venta ni en la búsqueda, pero sigue en Admin → Catálogo para reactivarlo.
 *
 *  Se escribe también en `precios_sucursal` (terminal multisucursal): al cambiar de sucursal o
 *  reabrir sesión `aplicarPreciosDeSucursal` reescribe `productos.activo` desde ahí, y sin esto
 *  el standby se deshacía solo. Viaja al ERP como disponibilidad de la sucursal. */
export async function alternarDisponibilidadProducto(db: SQLiteDatabase, id: string, activo: boolean, usuarioId: string): Promise<void> {
  const [sucursalId, dispositivoId] = await Promise.all([obtenerOCrearSucursalIdLocal(db), obtenerOCrearDispositivoId(db)]);
  await db.runAsync("UPDATE productos SET activo = ?, synced_at = NULL WHERE id = ?", activo ? 1 : 0, id);
  await db.runAsync("UPDATE precios_sucursal SET disponible = ? WHERE producto_id = ? AND sucursal_id = ?", activo ? 1 : 0, id, sucursalId);
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
