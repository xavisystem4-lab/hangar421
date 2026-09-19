import type { SQLiteDatabase } from "expo-sqlite";
import { uuid7 } from "@hangar421/shared";
import { generarSalt, derivarHashPin, algoritmoHashActual } from "../auth/offlineAuth";
import { erpFetch, obtenerTokensErp } from "../api/erpHttp";
import { obtenerSucursalErp, obtenerOCrearSucursalIdLocal } from "./dispositivoLocal";
import { obtenerEmpresaErp } from "../sync/pullEngine";

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
 *  pin_cache con hash salado) es el mismo esquema que dejaría esa adopción real. Si el
 *  dispositivo YA está conectado al ERP en este momento, además se intenta registrar como un
 *  Usuario real (ver registrarUsuarioEnErp) — best-effort, nunca bloquea el alta local si falla
 *  o no hay red: el PIN en texto plano solo existe en esta función mientras corre, nunca se
 *  guarda (ni aquí ni en ningún lado) para reintentarlo después. */
export async function crearUsuarioLocal(
  db: SQLiteDatabase,
  datos: { nombre: string; rol: string; pin: string },
): Promise<UsuarioLocal> {
  const id = uuid7();
  const salt = await generarSalt();
  const hashLocal = await derivarHashPin(datos.pin, salt);
  const ahora = new Date().toISOString();
  const sucursalId = await obtenerOCrearSucursalIdLocal(db);

  let erpUsuarioId: string | null = null;
  const conectado = await obtenerTokensErp();
  if (conectado) {
    erpUsuarioId = await registrarUsuarioEnErp(db, { nombre: datos.nombre, rol: datos.rol, pin: datos.pin }).catch(() => null);
  }

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      "INSERT INTO usuarios_locales (id, sucursal_id, nombre, rol, erp_usuario_id, activo, ultima_verificacion_online) VALUES (?, ?, ?, ?, ?, 1, ?)",
      id, sucursalId, datos.nombre, datos.rol, erpUsuarioId, ahora,
    );
    await db.runAsync(
      "INSERT INTO pin_cache (usuario_local_id, hash_local, salt, algoritmo, creado_at) VALUES (?, ?, ?, ?, ?)",
      id, hashLocal, salt, algoritmoHashActual, ahora,
    );
  });

  return { id, nombre: datos.nombre, rol: datos.rol, erpUsuarioId, activo: true, ultimaVerificacionOnline: ahora };
}

/** Da de alta un Usuario real en el ERP (POST /usuarios, ya existente — requiere que la sesión
 *  conectada tenga rol ADMIN_CORPORATIVO/ADMIN_SUCURSAL) para que el usuario del Punto de Venta
 *  también aparezca en el CRM/ERP. El `username` se genera del nombre + un sufijo corto para
 *  evitar choques (el campo es único server-side); el PIN se manda tal cual lo escribió el
 *  cajero en el alta, una sola vez, nunca se vuelve a guardar en ningún lado. Devuelve el id del
 *  Usuario creado, o null si falla (sin conexión, sin permiso, nombre de usuario chocado, etc.)
 *  — el usuario sigue funcionando 100% local aunque esto falle. */
export async function registrarUsuarioEnErp(db: SQLiteDatabase, datos: { nombre: string; rol: string; pin: string }): Promise<string | null> {
  const [empresaId, sucursalId] = await Promise.all([obtenerEmpresaErp(db), obtenerSucursalErp(db)]);
  if (!empresaId || !sucursalId) return null;

  const username = `${slugificar(datos.nombre)}.${uuid7().slice(0, 6)}`;
  const creado = await erpFetch<{ id: string }>("/usuarios", {
    method: "POST",
    body: JSON.stringify({
      empresaId,
      nombre: datos.nombre,
      username,
      pin: datos.pin,
      sucursales: [{ sucursalId, rol: datos.rol }],
    }),
  });
  return creado.id;
}

function slugificar(nombre: string): string {
  return nombre
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "") || "usuario";
}

/** Usuarios locales que todavía no se registraron en el ERP (creados mientras el dispositivo
 *  estaba desconectado) — no se pueden reintentar automáticamente porque el PIN en texto plano
 *  nunca se guarda; hace falta pedirlo de nuevo (ver PosAdminUsuariosScreen "Registrar en ERP"). */
export async function listarUsuariosSinRegistrarEnErp(db: SQLiteDatabase): Promise<UsuarioLocal[]> {
  const sucursalId = await obtenerOCrearSucursalIdLocal(db);
  const filas = await db.getAllAsync<any>(
    "SELECT * FROM usuarios_locales WHERE sucursal_id = ? AND activo = 1 AND erp_usuario_id IS NULL ORDER BY nombre",
    sucursalId,
  );
  return filas.map((f) => ({ id: f.id, nombre: f.nombre, rol: f.rol, erpUsuarioId: f.erp_usuario_id, activo: !!f.activo, ultimaVerificacionOnline: f.ultima_verificacion_online }));
}

export async function marcarRegistradoEnErp(db: SQLiteDatabase, usuarioLocalId: string, erpUsuarioId: string): Promise<void> {
  await db.runAsync("UPDATE usuarios_locales SET erp_usuario_id = ? WHERE id = ?", erpUsuarioId, usuarioLocalId);
}

/** Solo los usuarios de la sucursal activa (migración 3): el PIN se da de alta contra una
 *  sucursal concreta, y un cajero de una no debe poder abrir la caja de la otra desde el mismo
 *  dispositivo. Es también la lista que alimenta la pantalla de login local. */
export async function listarUsuariosLocales(db: SQLiteDatabase): Promise<UsuarioLocal[]> {
  const sucursalId = await obtenerOCrearSucursalIdLocal(db);
  const filas = await db.getAllAsync<any>(
    "SELECT * FROM usuarios_locales WHERE sucursal_id = ? AND activo = 1 ORDER BY nombre",
    sucursalId,
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
