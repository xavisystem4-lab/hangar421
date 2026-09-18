import type { SQLiteDatabase } from "expo-sqlite";
import { uuid7 } from "@hangar421/shared";
import { generarSalt, derivarHashPin, algoritmoHashActual } from "../auth/offlineAuth";

export interface UsuarioLocal {
  id: string;
  nombre: string;
  rol: string;
  erpUsuarioId: string | null;
  activo: boolean;
  ultimaVerificacionOnline: string | null;
}

/** Fase 1: no existe todavía el paso real de "adoptar dispositivo" en línea contra
 *  POST /auth/login-pin (eso es Fase 2b) — esta función es el equivalente LOCAL, para poder
 *  probar y usar el resto del flujo de venta/caja ya mismo. El resultado final (un
 *  usuarios_locales + pin_cache con hash salado) es exactamente el mismo esquema que dejará la
 *  adopción real; migrar a Fase 2b no cambia ninguna otra pieza. */
export async function crearUsuarioLocal(
  db: SQLiteDatabase,
  datos: { nombre: string; rol: string; pin: string; erpUsuarioId?: string },
): Promise<UsuarioLocal> {
  const id = uuid7();
  const salt = await generarSalt();
  const hashLocal = await derivarHashPin(datos.pin, salt);
  const ahora = new Date().toISOString();

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      "INSERT INTO usuarios_locales (id, nombre, rol, erp_usuario_id, activo, ultima_verificacion_online) VALUES (?, ?, ?, ?, 1, ?)",
      id, datos.nombre, datos.rol, datos.erpUsuarioId ?? null, ahora,
    );
    await db.runAsync(
      "INSERT INTO pin_cache (usuario_local_id, hash_local, salt, algoritmo, creado_at) VALUES (?, ?, ?, ?, ?)",
      id, hashLocal, salt, algoritmoHashActual, ahora,
    );
  });

  return { id, nombre: datos.nombre, rol: datos.rol, erpUsuarioId: datos.erpUsuarioId ?? null, activo: true, ultimaVerificacionOnline: ahora };
}

export async function listarUsuariosLocales(db: SQLiteDatabase): Promise<UsuarioLocal[]> {
  const filas = await db.getAllAsync<any>("SELECT * FROM usuarios_locales WHERE activo = 1 ORDER BY nombre");
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
