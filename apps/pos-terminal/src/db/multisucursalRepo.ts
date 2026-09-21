import type { SQLiteDatabase } from "expo-sqlite";
import { generarSalt, derivarHashPin, algoritmoHashActual } from "../auth/offlineAuth";
import { cambiarSucursalActiva } from "./dispositivoLocal";
import { guardarConfig, obtenerConfig } from "./configLocalRepo";

/**
 * Terminal multisucursal (código de empresa): en qué sucursales opera la tablet, quién tiene
 * asignada cada una y los precios de cada una. Todo local (migración 8) para que el login, la
 * elección de sucursal y el cambio de precios funcionen sin conexión; lo refresca el motor de
 * sincronización desde el ERP (ver sync/terminalErp.ts).
 *
 * Una terminal de UNA sucursal (código de sucursal, el esquema original) tiene
 * `sucursales_terminal` vacía y todo esto se comporta como antes.
 */

export interface SucursalTerminal {
  id: string;
  nombre: string;
}

export interface ContextoTerminal {
  sucursales: SucursalTerminal[];
  usuarios: { id: string; nombre: string; tienePin: boolean; sucursales: { sucursalId: string; rol: string }[] }[];
}

export interface PrecioSucursal {
  sucursalId: string;
  productoId: string;
  precio: number;
  disponible: boolean;
}

/** Usuario que se ofrece en el login. `requiereConexion`: está asignado en el ERP pero nunca
 *  entró en esta tablet, así que su primera entrada valida el PIN en línea. */
export interface UsuarioLogin {
  id: string;
  nombre: string;
  rol: string;
  requiereConexion: boolean;
}

const CLAVE_ALCANCE = "alcance_terminal";

/** Alcance con el que se vinculó la terminal. Solo una terminal de EMPRESA guarda contexto
 *  multisucursal: una enlazada por sucursal (o con correo de administrador, cuya sesión ve todas
 *  las sucursales) sigue funcionando exactamente como antes. */
export async function guardarAlcanceTerminal(db: SQLiteDatabase, alcance: "SUCURSAL" | "EMPRESA"): Promise<void> {
  await guardarConfig(db, CLAVE_ALCANCE, alcance);
  if (alcance === "SUCURSAL") {
    await db.withTransactionAsync(async () => {
      await db.runAsync("DELETE FROM sucursales_terminal");
      await db.runAsync("DELETE FROM usuarios_erp");
      await db.runAsync("DELETE FROM usuarios_sucursales");
      await db.runAsync("DELETE FROM precios_sucursal");
    });
  }
}

export async function esTerminalMultisucursal(db: SQLiteDatabase): Promise<boolean> {
  return (await obtenerConfig(db, CLAVE_ALCANCE)) === "EMPRESA";
}

export async function listarSucursalesTerminal(db: SQLiteDatabase): Promise<SucursalTerminal[]> {
  return db.getAllAsync<SucursalTerminal>("SELECT id, nombre FROM sucursales_terminal ORDER BY nombre");
}

/** Reemplaza el contexto completo: es una foto del ERP, lo que ya no viene deja de valer (una
 *  persona a la que le quitaron una sucursal no debe seguir pudiendo elegirla). */
export async function guardarContextoTerminal(db: SQLiteDatabase, ctx: ContextoTerminal): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync("DELETE FROM sucursales_terminal");
    await db.runAsync("DELETE FROM usuarios_erp");
    await db.runAsync("DELETE FROM usuarios_sucursales");
    for (const s of ctx.sucursales) {
      await db.runAsync("INSERT INTO sucursales_terminal (id, nombre) VALUES (?, ?)", s.id, s.nombre);
    }
    for (const u of ctx.usuarios) {
      await db.runAsync("INSERT INTO usuarios_erp (id, nombre, tiene_pin) VALUES (?, ?, ?)", u.id, u.nombre, u.tienePin ? 1 : 0);
      for (const a of u.sucursales) {
        await db.runAsync("INSERT OR REPLACE INTO usuarios_sucursales (usuario_id, sucursal_id, rol) VALUES (?, ?, ?)", u.id, a.sucursalId, a.rol);
      }
    }
  });
}

export async function guardarPreciosSucursal(db: SQLiteDatabase, filas: PrecioSucursal[]): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync("DELETE FROM precios_sucursal");
    for (const f of filas) {
      await db.runAsync(
        "INSERT INTO precios_sucursal (producto_id, sucursal_id, precio, disponible) VALUES (?, ?, ?, ?)",
        f.productoId, f.sucursalId, f.precio, f.disponible ? 1 : 0,
      );
    }
  });
}

/**
 * Deja en `productos` el precio y la disponibilidad de `sucursalId`, desde lo guardado. Solo toca
 * productos que tienen precio para esa sucursal: uno creado en la tablet sin conexión, o una
 * terminal de una sola sucursal (tabla vacía), quedan como estaban.
 */
export async function aplicarPreciosDeSucursal(db: SQLiteDatabase, sucursalId: string): Promise<void> {
  await db.runAsync(
    `UPDATE productos SET
       precio_base = (SELECT ps.precio FROM precios_sucursal ps WHERE ps.producto_id = productos.id AND ps.sucursal_id = ?),
       activo = (SELECT ps.disponible FROM precios_sucursal ps WHERE ps.producto_id = productos.id AND ps.sucursal_id = ?)
     WHERE id IN (SELECT producto_id FROM precios_sucursal WHERE sucursal_id = ?)`,
    sucursalId, sucursalId, sucursalId,
  );
}

/**
 * Personas que pueden entrar en esta tablet.
 *
 * Terminal de una sucursal: `null` — quien llama usa la lista de siempre (usuarios locales de la
 * sucursal activa). Terminal multisucursal: los usuarios locales con alguna sucursal de la
 * terminal (la propia o asignada en el ERP), más los asignados en el ERP que aún no entraron
 * aquí y tienen PIN en el ERP (sin PIN no hay con qué validar su primera entrada).
 */
export async function usuariosParaLogin(db: SQLiteDatabase): Promise<UsuarioLogin[] | null> {
  const sucursales = await listarSucursalesTerminal(db);
  if (sucursales.length === 0) return null;
  const ids = sucursales.map((s) => s.id);
  const marcas = ids.map(() => "?").join(",");

  const locales = await db.getAllAsync<{ id: string; nombre: string; rol: string }>(
    `SELECT id, nombre, rol FROM usuarios_locales
      WHERE activo = 1 AND (sucursal_id IN (${marcas}) OR id IN (SELECT usuario_id FROM usuarios_sucursales WHERE sucursal_id IN (${marcas})))`,
    ...ids, ...ids,
  );
  const deErp = await db.getAllAsync<{ id: string; nombre: string; rol: string }>(
    `SELECT e.id, e.nombre, (SELECT us.rol FROM usuarios_sucursales us WHERE us.usuario_id = e.id LIMIT 1) AS rol
       FROM usuarios_erp e
      WHERE e.tiene_pin = 1 AND e.id NOT IN (SELECT id FROM usuarios_locales WHERE activo = 1)`,
  );
  return [
    ...locales.map((u) => ({ ...u, requiereConexion: false })),
    ...deErp.map((u) => ({ id: u.id, nombre: u.nombre, rol: u.rol ?? "", requiereConexion: true })),
  ].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

/**
 * Sucursales entre las que puede elegir esta persona EN ESTA terminal: las asignadas en el ERP
 * que la terminal tiene. Un usuario creado en la tablet que aún no aparece en el ERP opera solo
 * en su sucursal de alta. Vacío = terminal de una sola sucursal (no hay nada que elegir).
 */
export async function sucursalesDelUsuario(db: SQLiteDatabase, usuarioId: string): Promise<SucursalTerminal[]> {
  const terminal = await listarSucursalesTerminal(db);
  if (terminal.length === 0) return [];
  const asignadas = await db.getAllAsync<SucursalTerminal>(
    `SELECT s.id, s.nombre FROM usuarios_sucursales us JOIN sucursales_terminal s ON s.id = us.sucursal_id
      WHERE us.usuario_id = ? ORDER BY s.nombre`,
    usuarioId,
  );
  if (asignadas.length > 0) return asignadas;
  const propia = await db.getFirstAsync<{ sucursal_id: string }>("SELECT sucursal_id FROM usuarios_locales WHERE id = ?", usuarioId);
  return terminal.filter((s) => s.id === propia?.sucursal_id);
}

/** Cambia la sucursal activa de la tablet (sin red): marcador + precios. Las ventas ya hechas
 *  conservan la sucursal con la que se registraron; solo lo nuevo va a la elegida. */
export async function activarSucursal(db: SQLiteDatabase, sucursal: SucursalTerminal): Promise<void> {
  await cambiarSucursalActiva(db, sucursal.id, sucursal.nombre);
  await aplicarPreciosDeSucursal(db, sucursal.id);
}

/**
 * Primera entrada de una persona del ERP en esta tablet, ya validada en línea: se guarda como
 * usuario local (con su MISMO id, que ya existe en el ERP, así que no se encola su alta) y con el
 * hash local de su PIN, para que la próxima vez entre sin conexión.
 */
export async function adoptarUsuarioErp(
  db: SQLiteDatabase,
  usuario: { id: string; nombre: string; sucursales: { sucursalId: string; rol: string }[] },
  pin: string,
): Promise<void> {
  const principal = usuario.sucursales[0];
  if (!principal) throw new Error("Esa persona no tiene ninguna sucursal de esta terminal");
  const salt = await generarSalt();
  const hash = await derivarHashPin(pin, salt);
  const ahora = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO usuarios_locales (id, sucursal_id, nombre, rol, erp_usuario_id, activo, ultima_verificacion_online) VALUES (?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre, rol = excluded.rol, erp_usuario_id = excluded.erp_usuario_id, activo = 1, ultima_verificacion_online = excluded.ultima_verificacion_online`,
      usuario.id, principal.sucursalId, usuario.nombre, principal.rol, usuario.id, ahora,
    );
    await db.runAsync(
      `INSERT INTO pin_cache (usuario_local_id, hash_local, salt, algoritmo, creado_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(usuario_local_id) DO UPDATE SET hash_local = excluded.hash_local, salt = excluded.salt, algoritmo = excluded.algoritmo, creado_at = excluded.creado_at`,
      usuario.id, hash, salt, algoritmoHashActual, ahora,
    );
    for (const a of usuario.sucursales) {
      await db.runAsync("INSERT OR REPLACE INTO usuarios_sucursales (usuario_id, sucursal_id, rol) VALUES (?, ?, ?)", usuario.id, a.sucursalId, a.rol);
    }
  });
}
