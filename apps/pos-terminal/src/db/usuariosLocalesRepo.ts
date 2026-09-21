import type { SQLiteDatabase } from "expo-sqlite";
import { uuid7, SyncEntidad, SyncOperacion } from "@hangar421/shared";
import { generarSalt, derivarHashPin, algoritmoHashActual } from "../auth/offlineAuth";
import { obtenerOCrearDispositivoId, obtenerOCrearSucursalIdLocal } from "./dispositivoLocal";
import { encolarSync } from "./outboxRepo";

export interface UsuarioLocal {
  id: string;
  nombre: string;
  rol: string;
  erpUsuarioId: string | null;
  activo: boolean;
  ultimaVerificacionOnline: string | null;
}

/** El alta local (nombre+PIN+rol) es el equivalente offline del paso real de "adoptar
 *  dispositivo" en línea contra POST /auth/login-pin — el resultado (usuarios_locales +
 *  pin_cache con hash salado) es el mismo esquema que dejaría esa adopción real.
 *
 *  El registro en el ERP viaja por la cola de sincronización (SyncEntidad.USUARIO) con el MISMO
 *  id, en la misma transacción que el alta: funciona sin conexión y con la sesión de cajero de
 *  una tablet vinculada por código. Antes se intentaba en el momento con POST /usuarios, que
 *  exige sesión de administrador y creaba el usuario con OTRO id — así que casi nunca llegaba y,
 *  cuando llegaba, las ventas que nombraban el id local igual quedaban sin atribución. El PIN no
 *  viaja: nunca sale de esta función en texto plano. */
export async function crearUsuarioLocal(
  db: SQLiteDatabase,
  datos: { nombre: string; rol: string; pin: string },
): Promise<UsuarioLocal> {
  const id = uuid7();
  const salt = await generarSalt();
  const hashLocal = await derivarHashPin(datos.pin, salt);
  const ahora = new Date().toISOString();
  const sucursalId = await obtenerOCrearSucursalIdLocal(db);
  const dispositivoId = await obtenerOCrearDispositivoId(db);

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      "INSERT INTO usuarios_locales (id, sucursal_id, nombre, rol, erp_usuario_id, activo, ultima_verificacion_online) VALUES (?, ?, ?, ?, NULL, 1, ?)",
      id, sucursalId, datos.nombre, datos.rol, ahora,
    );
    await db.runAsync(
      "INSERT INTO pin_cache (usuario_local_id, hash_local, salt, algoritmo, creado_at) VALUES (?, ?, ?, ?, ?)",
      id, hashLocal, salt, algoritmoHashActual, ahora,
    );
    await encolarAltaEnErp(db, { id, nombre: datos.nombre, rol: datos.rol, sucursalId, dispositivoId });
  });

  return { id, nombre: datos.nombre, rol: datos.rol, erpUsuarioId: null, activo: true, ultimaVerificacionOnline: ahora };
}

async function encolarAltaEnErp(
  db: SQLiteDatabase,
  u: { id: string; nombre: string; rol: string; sucursalId: string; dispositivoId: string },
): Promise<void> {
  await encolarSync(db, {
    entidad: SyncEntidad.USUARIO,
    operacion: SyncOperacion.CREATE,
    entidadId: u.id,
    sucursalId: u.sucursalId,
    dispositivoId: u.dispositivoId,
    payload: { nombre: u.nombre, rol: u.rol },
  });
}

/** Encola el alta en el ERP de los usuarios locales que nunca llegaron (creados antes de que el
 *  alta viajara por la cola). Idempotente: se salta a quien ya tiene su alta en la cola, en
 *  cualquier estado, así que puede correr en cada arranque del motor de sincronización. */
export async function encolarUsuariosSinRegistrarEnErp(db: SQLiteDatabase): Promise<number> {
  const faltantes = await db.getAllAsync<{ id: string; nombre: string; rol: string; sucursal_id: string }>(
    `SELECT u.id, u.nombre, u.rol, u.sucursal_id FROM usuarios_locales u
      WHERE u.erp_usuario_id IS NULL AND u.activo = 1 AND u.sucursal_id <> ''
        AND NOT EXISTS (SELECT 1 FROM sync_outbox o WHERE o.entidad = ? AND o.entidad_id = u.id)`,
    SyncEntidad.USUARIO,
  );
  if (faltantes.length === 0) return 0;
  const dispositivoId = await obtenerOCrearDispositivoId(db);
  await db.withTransactionAsync(async () => {
    for (const u of faltantes) {
      await encolarAltaEnErp(db, { id: u.id, nombre: u.nombre, rol: u.rol, sucursalId: u.sucursal_id, dispositivoId });
    }
  });
  return faltantes.length;
}

/** Un usuario local por id, sin acotar a la sucursal activa: al entrar en una terminal
 *  multisucursal la sucursal todavía no está elegida. */
export async function obtenerUsuarioLocal(db: SQLiteDatabase, id: string): Promise<UsuarioLocal | null> {
  const f = await db.getFirstAsync<any>("SELECT * FROM usuarios_locales WHERE id = ? AND activo = 1", id);
  if (!f) return null;
  return { id: f.id, nombre: f.nombre, rol: f.rol, erpUsuarioId: f.erp_usuario_id, activo: !!f.activo, ultimaVerificacionOnline: f.ultima_verificacion_online };
}

/** Lo llama el motor de sincronización cuando el ERP confirma el alta (SyncEntidad.USUARIO). */
export async function marcarRegistradoEnErp(db: SQLiteDatabase, usuarioLocalId: string, erpUsuarioId: string): Promise<void> {
  await db.runAsync("UPDATE usuarios_locales SET erp_usuario_id = ? WHERE id = ?", erpUsuarioId, usuarioLocalId);
}

/** Solo los usuarios de la sucursal activa (migración 3): el PIN se da de alta contra una
 *  sucursal concreta, y un cajero de una no debe poder abrir la caja de la otra desde el mismo
 *  dispositivo. Es también la lista que alimenta la pantalla de login local. */
export async function listarUsuariosLocales(db: SQLiteDatabase): Promise<UsuarioLocal[]> {
  const sucursalId = await obtenerOCrearSucursalIdLocal(db);
  // Terminal multisucursal: también cuenta quien tiene ESTA sucursal asignada en el ERP aunque
  // su alta en la tablet haya sido en otra (ver multisucursalRepo).
  const filas = await db.getAllAsync<any>(
    `SELECT * FROM usuarios_locales
      WHERE activo = 1 AND (sucursal_id = ? OR id IN (SELECT usuario_id FROM usuarios_sucursales WHERE sucursal_id = ?))
      ORDER BY nombre`,
    sucursalId, sucursalId,
  );
  return filas.map((f) => ({
    id: f.id,
    nombre: f.nombre,
    rol: f.rol,
    erpUsuarioId: f.erp_usuario_id,
    activo: !!f.activo,
    ultimaVerificacionOnline: f.ultima_verificacion_online,
  }));
}

/** Valida el PIN completamente offline contra el hash local cacheado — nunca sale a red. */
export async function validarPinLocal(db: SQLiteDatabase, usuarioLocalId: string, pin: string): Promise<boolean> {
  const fila = await db.getFirstAsync<{ hash_local: string; salt: string }>(
    "SELECT hash_local, salt FROM pin_cache WHERE usuario_local_id = ?",
    usuarioLocalId,
  );
  if (!fila) return false;
  const hashIntentado = await derivarHashPin(pin, fila.salt);
  return hashIntentado === fila.hash_local;
}

/** Revocación local — un admin borra el acceso de este dispositivo a un usuario específico sin
 *  necesitar conexión (ver Decisión #3: el hueco real es que sigue funcionando hasta que alguien
 *  haga esto a mano, o hasta la próxima revalidación en línea). */
export async function eliminarUsuarioLocal(db: SQLiteDatabase, usuarioLocalId: string): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync("DELETE FROM pin_cache WHERE usuario_local_id = ?", usuarioLocalId);
    await db.runAsync("UPDATE usuarios_locales SET activo = 0 WHERE id = ?", usuarioLocalId);
  });
}

/**
 * Traduce ids de usuario LOCALES a los del ERP.
 *
 * Es la causa por la que una venta podía no llegar nunca al ERP: `Pedido.meseroId` y
 * `Pedido.cajeroId` son claves foráneas a `Usuario`, pero el APK mandaba el id de
 * `usuarios_locales`, que es un uuid7 generado en la tablet. Para un cajero dado de alta sin
 * conexión ese id no existe server-side, y Prisma rechaza el pedido ENTERO por violación de
 * clave foránea — no solo el campo.
 *
 * Devuelve un mapa localId → erpId. Desde que el alta viaja por la cola (SyncEntidad.USUARIO),
 * un usuario nuevo existe en el ERP con su MISMO id, así que quien no aparece aquí se manda tal
 * cual. El mapa solo importa para los usuarios viejos que se registraron por POST /usuarios con
 * un id distinto.
 */
export async function mapaUsuariosErp(db: SQLiteDatabase): Promise<Map<string, string>> {
  const filas = await db.getAllAsync<{ id: string; erp_usuario_id: string | null }>(
    "SELECT id, erp_usuario_id FROM usuarios_locales WHERE erp_usuario_id IS NOT NULL",
  );
  return new Map(filas.filter((f) => f.erp_usuario_id).map((f) => [f.id, f.erp_usuario_id as string]));
}
