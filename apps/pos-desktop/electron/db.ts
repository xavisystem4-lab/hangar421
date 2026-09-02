import Database from "better-sqlite3";
import { app } from "electron";
import * as path from "path";
import { randomUUID } from "crypto";

/**
 * Base de datos local del POS (SQLite vía better-sqlite3), vive en el proceso principal
 * de Electron. Guarda:
 *  - `outbox`: cola de operaciones pendientes de sincronizar hacia la nube (offline-first).
 *  - `cache`: espejo local de catálogo/pedidos/mesas para operar sin conexión (llenado por /sync/pull).
 *  - `config`: pares clave/valor (deviceId persistente, última sesión, etc.)
 */
let db: Database.Database;

export function iniciarBaseDeDatos() {
  const dbPath = path.join(app.getPath("userData"), "hangar421-local.sqlite");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS outbox (
      local_id TEXT PRIMARY KEY,
      entidad TEXT NOT NULL,
      operacion TEXT NOT NULL,
      entidad_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      sucursal_id TEXT NOT NULL,
      dispositivo_id TEXT NOT NULL,
      usuario_id TEXT,
      payload TEXT NOT NULL,
      estado TEXT NOT NULL DEFAULT 'PENDING',
      intentos INTEGER NOT NULL DEFAULT 0,
      ultimo_error TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cache (
      coleccion TEXT NOT NULL,
      id TEXT NOT NULL,
      json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (coleccion, id)
    );

    CREATE TABLE IF NOT EXISTS config (
      clave TEXT PRIMARY KEY,
      valor TEXT NOT NULL
    );
  `);

  return db;
}

export function obtenerDeviceId(): string {
  const row = db.prepare("SELECT valor FROM config WHERE clave = 'device_id'").get() as { valor: string } | undefined;
  if (row) return row.valor;
  const id = randomUUID();
  db.prepare("INSERT INTO config (clave, valor) VALUES ('device_id', ?)").run(id);
  return id;
}

export function encolarOperacion(item: {
  localId: string;
  entidad: string;
  operacion: string;
  entidadId: string;
  idempotencyKey: string;
  sucursalId: string;
  dispositivoId: string;
  usuarioId?: string;
  payload: unknown;
}) {
  db.prepare(
    `INSERT OR IGNORE INTO outbox
      (local_id, entidad, operacion, entidad_id, idempotency_key, sucursal_id, dispositivo_id, usuario_id, payload, created_at)
     VALUES (@localId, @entidad, @operacion, @entidadId, @idempotencyKey, @sucursalId, @dispositivoId, @usuarioId, @payload, @createdAt)`,
  ).run({
    ...item,
    usuarioId: item.usuarioId ?? null,
    payload: JSON.stringify(item.payload),
    createdAt: new Date().toISOString(),
  });
}

export function outboxPendiente(limite = 200) {
  return db
    .prepare(`SELECT * FROM outbox WHERE estado IN ('PENDING', 'ERROR') ORDER BY created_at ASC LIMIT ?`)
    .all(limite) as any[];
}

export function marcarSincronizado(localId: string) {
  db.prepare(`UPDATE outbox SET estado = 'SYNCED' WHERE local_id = ?`).run(localId);
}

export function marcarError(localId: string, error: string) {
  db.prepare(`UPDATE outbox SET estado = 'ERROR', ultimo_error = ?, intentos = intentos + 1 WHERE local_id = ?`).run(error, localId);
}

export function contarPendientes(): number {
  const row = db.prepare(`SELECT COUNT(*) as n FROM outbox WHERE estado IN ('PENDING', 'ERROR')`).get() as { n: number };
  return row.n;
}

export function guardarEnCache(coleccion: string, id: string, data: unknown) {
  db.prepare(
    `INSERT INTO cache (coleccion, id, json, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(coleccion, id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
  ).run(coleccion, id, JSON.stringify(data), new Date().toISOString());
}

export function listarCache(coleccion: string): unknown[] {
  const rows = db.prepare(`SELECT json FROM cache WHERE coleccion = ?`).all(coleccion) as { json: string }[];
  return rows.map((r) => JSON.parse(r.json));
}

export function obtenerConfig(clave: string): string | null {
  const row = db.prepare("SELECT valor FROM config WHERE clave = ?").get(clave) as { valor: string } | undefined;
  return row?.valor ?? null;
}

export function guardarConfig(clave: string, valor: string) {
  db.prepare(
    `INSERT INTO config (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`,
  ).run(clave, valor);
}
