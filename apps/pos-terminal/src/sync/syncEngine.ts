import type { SyncEnvelope, SyncPushResponse } from "@hangar421/shared";
import { abrirBaseDeDatos } from "../db/database";
import { pendientesParaDrenar, marcarSincronizado, marcarError, contarPendientes } from "../db/outboxRepo";
import { erpFetch, obtenerTokensErp } from "../api/erpHttp";
import { useSyncStatusStore } from "../store/syncStatusStore";

// Más espaciado que los 8s de apps/waiter-mobile: ahí el destino es una Estación en la misma
// red LAN; aquí es el ERP en la nube (Railway) — pollear cada 8s no aporta nada y sí gasta
// batería/datos sin necesidad, ver plan Parte B "Sincronización".
const INTERVALO_MS = 45_000;

let intervalo: ReturnType<typeof setInterval> | null = null;

export function iniciarSync() {
  if (intervalo) return;
  procesarCola();
  intervalo = setInterval(procesarCola, INTERVALO_MS);
}

export function detenerSync() {
  if (intervalo) clearInterval(intervalo);
  intervalo = null;
}

/** Drena sync_outbox hacia POST /sync/push, en el orden en que se encolaron (ver
 *  outboxRepo.pendientesParaDrenar). `ignorarBackoff: true` es lo que usa el botón manual
 *  "Sincronizar ahora" — salta la espera programada, nunca la conexión en sí (si de verdad no
 *  hay red, sigue sin poder mandar nada, con o sin backoff). */
export async function procesarCola(ignorarBackoff = false): Promise<void> {
  const db = await abrirBaseDeDatos();
  const status = useSyncStatusStore.getState();

  const tokens = await obtenerTokensErp();
  status.setConectadoAlErp(!!tokens);
  if (!tokens) {
    status.setEstado("SIN_CONEXION");
    status.setPendientes(await contarPendientes(db));
    return;
  }

  const items = await pendientesParaDrenar(db, ignorarBackoff);
  if (items.length === 0) {
    status.setEstado("SINCRONIZADO");
    status.setPendientes(0);
    return;
  }

  status.setEstado("PENDIENTE");
  status.setSincronizando(true);
  try {
    const envelopes: SyncEnvelope[] = items.map((it) => ({
      id: it.entidadId,
      entidad: it.entidad as any,
      operacion: it.operacion as any,
      idempotencyKey: it.idempotencyKey,
      dispositivoId: it.dispositivoId,
      sucursalId: it.sucursalId,
      usuarioId: it.usuarioId ?? undefined,
      createdAtLocal: it.createdAt,
      payload: it.payload,
    }));

    const resp = await erpFetch<SyncPushResponse>("/sync/push", { method: "POST", body: JSON.stringify({ items: envelopes }) });

    for (const item of items) {
      const resultado = resp.resultados.find((r) => r.idempotencyKey === item.idempotencyKey);
      if (!resultado) continue;
      if (resultado.estado === "SYNCED") {
        await marcarSincronizado(db, item.localId);
      } else {
        await marcarError(db, item.localId, resultado.error ?? "Error desconocido", item.intentos);
      }
    }

    const restantes = await contarPendientes(db);
    status.setEstado(restantes === 0 ? "SINCRONIZADO" : "PENDIENTE");
    status.setPendientes(restantes);
    status.setUltimoError(null);
  } catch (e: any) {
    // El request completo falló (red caída, timeout, 5xx) — no hay resultados por item, así que
    // ninguna fila cambia de estado: se quedan PENDING tal cual, listas para el próximo ciclo.
    // Distinguir "sin red" de "error real del servidor" por el mensaje ya clasificado en
    // erpHttp.ts (mismo criterio que conexionStore.ts en waiter-mobile).
    const esErrorDeRed = /network|timeout|fetch/i.test(e?.message ?? "");
    status.setEstado(esErrorDeRed ? "SIN_CONEXION" : "ERROR");
    status.setUltimoError(e.message ?? "Error de sincronización");
    status.setPendientes(await contarPendientes(db));
  } finally {
    status.setSincronizando(false);
  }
}
