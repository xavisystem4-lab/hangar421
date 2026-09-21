import type { SQLiteDatabase } from "expo-sqlite";
import { uuid7, SyncEntidad, SyncOperacion } from "@hangar421/shared";
import { encolarSync } from "./outboxRepo";
import { obtenerOCrearDispositivoId, obtenerOCrearSucursalIdLocal } from "./dispositivoLocal";

/** Mismo tope que el ERP (solicitudes-producto.service.ts): es lo tecleado en un buscador. */
const LARGO_MAXIMO = 120;

/**
 * Pide al administrador que dé de alta un producto que no está en el catálogo.
 *
 * Regla del negocio: el producto NO se crea ni se vende como "artículo pendiente" — la venta se
 * detiene y solo queda esta solicitud. Va por la cola de sincronización, así que funciona sin
 * conexión; el ERP guarda quién (el usuario del sobre), dónde (la sucursal), desde qué equipo y
 * la hora real de la tablet (`createdAtLocal`).
 */
export async function solicitarAltaProducto(db: SQLiteDatabase, datos: { texto: string; usuarioId?: string }): Promise<string> {
  const texto = datos.texto.replace(/\s+/g, " ").trim().slice(0, LARGO_MAXIMO);
  if (!texto) throw new Error("Escribe el nombre o la descripción del producto");

  const id = uuid7();
  const [sucursalId, dispositivoId] = await Promise.all([obtenerOCrearSucursalIdLocal(db), obtenerOCrearDispositivoId(db)]);
  await encolarSync(db, {
    entidad: SyncEntidad.SOLICITUD_PRODUCTO,
    operacion: SyncOperacion.CREATE,
    entidadId: id,
    sucursalId,
    dispositivoId,
    usuarioId: datos.usuarioId,
    payload: { texto },
  });
  return id;
}
