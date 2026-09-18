import type { SQLiteDatabase } from "expo-sqlite";
import { uuid7, type SyncEntidad, type SyncOperacion } from "@hangar421/shared";

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
