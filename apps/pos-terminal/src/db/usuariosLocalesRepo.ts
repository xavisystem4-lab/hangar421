import type { SQLiteDatabase } from "expo-sqlite";
import { uuid7, SyncEntidad, SyncOperacion } from "@hangar421/shared";
import { generarSalt, derivarHashPin, algoritmoHashActual } from "../auth/offlineAuth";
import { obtenerOCrearDispositivoId, obtenerOCrearSucursalIdLocal } from "./dispositivoLocal";
import { encolarSync } from "./outboxRepo";
import { leerPermisosGuardados } from "../auth/permisosTerminal";

export interface UsuarioLocal {
  id: string;
  nombre: string;
  rol: string;
  erpUsuarioId: string | null;
  activo: boolean;
  ultimaVerificacionOnline: string | null;
  /** Funciones personalizadas en esta tablet; null = las del rol (ver permisosTerminal). */
  permisos: string[] | null;
  /** El ERP le asignó sucursales a esta persona (terminal multisucursal): su rol lo manda el
   *  ERP y se reescribe en cada sincronización, así que no se puede cambiar desde la tablet. */
  rolDesdeErp?: boolean;
  /** Turno de trabajo asignado (informativo, ver turnosTrabajoRepo). */
  turnoTrabajoId?: string | null;
}

function aUsuarioLocal(f: any): UsuarioLocal {
  return {
    id: f.id,
    nombre: f.nombre,
    rol: f.rol,
    erpUsuarioId: f.erp_usuario_id,
    activo: !!f.activo,
    ultimaVerificacionOnline: f.ultima_verificacion_online,
    permisos: leerPermisosGuardados(f.permisos_json),
    rolDesdeErp: !!f.rol_desde_erp,
    turnoTrabajoId: f.turno_trabajo_id ?? null,
  };
}

/**
 * Rol y funciones de una persona en ESTA tablet. Solo lo llama Admin → Usuarios.
 *
 * `permisos` null vuelve a los del rol. El rol no viaja al ERP (el ERP conserva el suyo): por
 * eso quien pasa a supervisor aquí autoriza en la tablet, pero el ERP puede rechazar una
 * cancelación que autorice hasta que también se le cambie allá.
 */
export async function guardarRolYPermisos(
  db: SQLiteDatabase,
  usuarioLocalId: string,
  datos: { rol?: string; permisos: string[] | null },
): Promise<void> {
  const permisosJson = datos.permisos ? JSON.stringify(datos.permisos) : null;
  if (datos.rol) {
    await db.runAsync("UPDATE usuarios_locales SET rol = ?, permisos_json = ? WHERE id = ?", datos.rol, permisosJson, usuarioLocalId);
  } else {
    await db.runAsync("UPDATE usuarios_locales SET permisos_json = ? WHERE id = ?", permisosJson, usuarioLocalId);
  }
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
/** ¿Otra persona de esta tablet ya usa ese PIN? Devuelve su nombre. El PIN es personal: con dos
 *  iguales una puede entrar con el usuario de la otra. */
export async function pinEnUsoLocal(db: SQLiteDatabase, pin: string, excluirUsuarioId?: string): Promise<string | null> {
  const filas = await db.getAllAsync<{ id: string; nombre: string; hash_local: string; salt: string }>(
    `SELECT u.id, u.nombre, p.hash_local, p.salt FROM pin_cache p JOIN usuarios_locales u ON u.id = p.usuario_local_id WHERE u.activo = 1`,
  );
  for (const f of filas) {
    if (f.id === excluirUsuarioId) continue;
    if ((await derivarHashPin(pin, f.salt)) === f.hash_local) return f.nombre;
  }
  return null;
}

/**
 * Cambia el PIN de una persona EN ESTA TABLET (Admin → Usuarios). Sirve para que alguien pueda
 * entrar ya, sin esperar al ERP. No toca el PIN del ERP: la tablet entra con su copia local (ver
 * auth/pinEnLinea.ts). El PIN tampoco puede repetirse con el de otra persona de la tablet.
 */
export async function cambiarPinLocal(db: SQLiteDatabase, usuarioLocalId: string, pin: string): Promise<void> {
  if (!/^\d{4,6}$/.test(pin)) throw new Error("El PIN debe tener de 4 a 6 números.");
  const ocupado = await pinEnUsoLocal(db, pin, usuarioLocalId);
  if (ocupado) throw new Error(`Ese PIN ya lo usa ${ocupado}. El PIN es personal: elige otro.`);
  const salt = await generarSalt();
  const hash = await derivarHashPin(pin, salt);
  const ahora = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    // Persona del ERP que nunca entró en esta tablet: se da de alta aquí con su mismo id, así
    // entra ya con el PIN nuevo sin validar en línea.
    const local = await db.getFirstAsync<{ id: string }>("SELECT id FROM usuarios_locales WHERE id = ?", usuarioLocalId);
    if (!local) {
      const erp = await db.getFirstAsync<{ nombre: string }>("SELECT nombre FROM usuarios_erp WHERE id = ?", usuarioLocalId);
      if (!erp) throw new Error("No se encontró a esa persona en esta tablet.");
      const asignacion = await db.getFirstAsync<{ sucursal_id: string; rol: string }>("SELECT sucursal_id, rol FROM usuarios_sucursales WHERE usuario_id = ? LIMIT 1", usuarioLocalId);
      const sucursalId = asignacion?.sucursal_id ?? (await obtenerOCrearSucursalIdLocal(db));
      await db.runAsync(
        "INSERT INTO usuarios_locales (id, sucursal_id, nombre, rol, erp_usuario_id, activo, ultima_verificacion_online) VALUES (?, ?, ?, ?, ?, 1, ?)",
        usuarioLocalId, sucursalId, erp.nombre, asignacion?.rol ?? "CAJERO", usuarioLocalId, ahora,
      );
    } else {
      await db.runAsync("UPDATE usuarios_locales SET activo = 1 WHERE id = ?", usuarioLocalId);
    }
    await db.runAsync(
      `INSERT INTO pin_cache (usuario_local_id, hash_local, salt, algoritmo, creado_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(usuario_local_id) DO UPDATE SET hash_local = excluded.hash_local, salt = excluded.salt, algoritmo = excluded.algoritmo, creado_at = excluded.creado_at`,
      usuarioLocalId, hash, salt, algoritmoHashActual, ahora,
    );
  });
}

export async function crearUsuarioLocal(
  db: SQLiteDatabase,
  datos: { nombre: string; rol: string; pin: string },
): Promise<UsuarioLocal> {
  const ocupado = await pinEnUsoLocal(db, datos.pin);
  if (ocupado) throw new Error(`Ese PIN ya lo usa ${ocupado}. El PIN es personal: elige otro.`);
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

  return { id, nombre: datos.nombre, rol: datos.rol, erpUsuarioId: null, activo: true, ultimaVerificacionOnline: ahora, permisos: null };
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
  return f ? aUsuarioLocal(f) : null;
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
    `SELECT u.*, us.rol AS rol_erp, (us.usuario_id IS NOT NULL) AS rol_desde_erp FROM usuarios_locales u
      LEFT JOIN usuarios_sucursales us ON us.usuario_id = u.id AND us.sucursal_id = ?
      WHERE u.activo = 1 AND (u.sucursal_id = ? OR us.usuario_id IS NOT NULL)
      ORDER BY u.nombre`,
    sucursalId, sucursalId,
  );
  // El rol que se muestra es el que rige en ESTA sucursal: el del ERP si lo asignó.
  return filas.map((f) => aUsuarioLocal({ ...f, rol: f.rol_erp ?? f.rol }));
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
