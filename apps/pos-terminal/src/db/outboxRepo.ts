import type { SQLiteDatabase } from "expo-sqlite";
import { uuid7, type SyncEntidad, type SyncOperacion } from "@hangar421/shared";
import { calcularProximoReintentoIso, yaPuedeReintentar } from "../sync/backoff";

export interface ItemOutbox {
  localId: string;
  entidad: string;
  operacion: string;
  entidadId: string;
  idempotencyKey: string;
  sucursalId: string;
  dispositivoId: string;
  usuarioId: string | null;
  payload: unknown;
  estado: "PENDING" | "SYNCING" | "SYNCED" | "ERROR";
  intentos: number;
  createdAt: string;
}

export interface NuevoItemOutbox {
  entidad: SyncEntidad;
  operacion: SyncOperacion;
  entidadId: string;
  payload: unknown;
  sucursalId: string;
  dispositivoId: string;
  usuarioId?: string;
}

/** Inserta una fila en sync_outbox DENTRO de la transacción del llamador (ventasRepo/turnosRepo
 *  la invocan desde su propio `withTransactionAsync`, así que la venta/turno y su(s) evento(s) de
 *  sync se confirman o se descartan juntos — nunca queda una venta local sin su outbox, ni un
 *  outbox huérfano sin venta). `orden_secuencia` es el correlativo que garantiza que, al drenar
 *  la cola (Fase 2a), un envío multi-entidad de una venta llegue a /sync/push en el orden
 *  PEDIDO→ITEMS→DESCUENTO→PAGO que espera sync.service.ts (`enrutar()` del backend). */
export async function encolarSync(db: SQLiteDatabase, item: NuevoItemOutbox): Promise<string> {
  const localId = uuid7();
  const idempotencyKey = uuid7();
  const ahora = new Date().toISOString();
  const { orden } = (await db.getFirstAsync<{ orden: number }>("SELECT COALESCE(MAX(orden_secuencia), 0) + 1 AS orden FROM sync_outbox")) ?? { orden: 1 };

  await db.runAsync(
    `INSERT INTO sync_outbox
       (local_id, entidad, operacion, entidad_id, idempotency_key, sucursal_id, dispositivo_id, usuario_id, payload, estado, intentos, orden_secuencia, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, ?, ?)`,
    localId, item.entidad, item.operacion, item.entidadId, idempotencyKey, item.sucursalId, item.dispositivoId, item.usuarioId ?? null,
    JSON.stringify(item.payload), orden, ahora,
  );

  return localId;
}

/** Filas listas para drenar, en el orden en que se crearon (`orden_secuencia`) — respeta el
 *  backoff: una fila con `next_retry_at` en el futuro no se incluye todavía. El botón manual
 *  "Sincronizar ahora" pasa `ignorarBackoff: true` para saltárselo por completo. */
export async function pendientesParaDrenar(db: SQLiteDatabase, ignorarBackoff = false): Promise<ItemOutbox[]> {
  const filas = await db.getAllAsync<any>(
    "SELECT * FROM sync_outbox WHERE estado IN ('PENDING', 'ERROR') ORDER BY orden_secuencia ASC",
  );
  const candidatas = ignorarBackoff ? filas : filas.filter((f) => yaPuedeReintentar(f.next_retry_at));
  return candidatas.map((f) => ({
    localId: f.local_id,
    entidad: f.entidad,
    operacion: f.operacion,
    entidadId: f.entidad_id,
    idempotencyKey: f.idempotency_key,
    sucursalId: f.sucursal_id,
    dispositivoId: f.dispositivo_id,
    usuarioId: f.usuario_id,
    payload: JSON.parse(f.payload),
    estado: f.estado,
    intentos: f.intentos,
    createdAt: f.created_at,
  }));
}

export async function marcarSincronizado(db: SQLiteDatabase, localId: string): Promise<void> {
  await db.runAsync("UPDATE sync_outbox SET estado = 'SYNCED', synced_at = ?, next_retry_at = NULL WHERE local_id = ?", new Date().toISOString(), localId);
}

export async function marcarError(db: SQLiteDatabase, localId: string, mensaje: string, intentosPrevios: number): Promise<void> {
  const proximoReintento = calcularProximoReintentoIso(intentosPrevios);
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      "UPDATE sync_outbox SET estado = 'ERROR', ultimo_error = ?, intentos = intentos + 1, next_retry_at = ? WHERE local_id = ?",
      mensaje, proximoReintento, localId,
    );
    await db.runAsync(
      "INSERT INTO sync_error_log (id, outbox_local_id, entidad, mensaje, payload_snapshot, created_at) SELECT ?, local_id, entidad, ?, payload, ? FROM sync_outbox WHERE local_id = ?",
      uuid7(), mensaje, new Date().toISOString(), localId,
    );
  });
}

export async function contarPendientes(db: SQLiteDatabase): Promise<number> {
  const fila = await db.getFirstAsync<{ total: number }>("SELECT COUNT(*) as total FROM sync_outbox WHERE estado IN ('PENDING', 'ERROR')");
  return fila?.total ?? 0;
}

export interface ProblemaSync {
  localId: string;
  entidad: string;
  entidadId: string;
  intentos: number;
  ultimoError: string;
  createdAt: string;
  /** Folio de la venta cuando la entidad es un PEDIDO — es por lo que pregunta el cajero. */
  folioLocal: number | null;
}

/**
 * Lo que no ha conseguido llegar al ERP, CON el mensaje del servidor.
 *
 * Antes este dato existía en la base pero no se mostraba en ninguna parte: la app decía
 * "Error de sincronización" y el motivo real ("Uno de los productos del pedido ya no existe en
 * el catálogo") se quedaba en la fila. Sin esto no hay forma de saber qué ventas no llegaron ni
 * por qué, que es exactamente lo que pide la trazabilidad.
 */
export async function listarProblemasSync(db: SQLiteDatabase, limite = 50): Promise<ProblemaSync[]> {
  const filas = await db.getAllAsync<any>(
    `SELECT o.local_id, o.entidad, o.entidad_id, o.intentos, o.ultimo_error, o.created_at, v.folio_local
     FROM sync_outbox o LEFT JOIN ventas v ON v.id = o.entidad_id
     WHERE o.estado = 'ERROR' AND o.ultimo_error IS NOT NULL
     ORDER BY o.orden_secuencia DESC LIMIT ?`,
    limite,
  );
  return filas.map((f) => ({
    localId: f.local_id,
    entidad: f.entidad,
    entidadId: f.entidad_id,
    intentos: f.intentos,
    ultimoError: f.ultimo_error,
    createdAt: f.created_at,
    folioLocal: f.folio_local ?? null,
  }));
}

/** Devuelve a la cola una fila en ERROR, para reintentar después de arreglar la causa (por
 *  ejemplo tras descargar el catálogo del ERP). No borra nada: solo limpia el backoff. */
export async function reintentarProblema(db: SQLiteDatabase, localId: string): Promise<void> {
  await db.runAsync(
    "UPDATE sync_outbox SET estado = 'PENDING', next_retry_at = NULL WHERE local_id = ?",
    localId,
  );
}
