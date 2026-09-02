import { apiFetch } from "../api/http";
import * as outbox from "../db/outbox";
import { useSyncStore } from "../store/syncStore";

interface AccionSincronizable {
  id: string;
  entidad: string;
  operacion: "CREATE" | "UPDATE" | "DELETE";
  entidadId: string;
  idempotencyKey: string;
  sucursalId: string;
  dispositivoId: string;
  usuarioId?: string;
  payload: unknown;
}

/** Igual que en el POS Windows: intenta la acción en línea; si falla por conectividad
 *  (no por un error de negocio), la encola en AsyncStorage para reintentar después. */
export async function encolarSyncSiFalla<T>(intentoOnline: () => Promise<T>, item: AccionSincronizable): Promise<T | void> {
  try {
    return await intentoOnline();
  } catch (e: any) {
    const esErrorDeRed = e instanceof TypeError || /network|fetch/i.test(e?.message ?? "");
    if (!esErrorDeRed) throw e;

    await outbox.encolar({
      localId: item.id,
      entidad: item.entidad,
      operacion: item.operacion,
      entidadId: item.entidadId,
      idempotencyKey: item.idempotencyKey,
      sucursalId: item.sucursalId,
      dispositivoId: item.dispositivoId,
      usuarioId: item.usuarioId,
      payload: item.payload,
    });
    await actualizarContador();
  }
}

let intervalo: ReturnType<typeof setInterval> | null = null;

export function iniciarSync() {
  if (intervalo) return;
  procesarCola();
  actualizarContador();
  intervalo = setInterval(procesarCola, 8_000);
}

export function detenerSync() {
  if (intervalo) clearInterval(intervalo);
  intervalo = null;
}

export async function procesarCola() {
  const items = await outbox.pendientes();
  if (items.length === 0) {
    useSyncStore.getState().setEstado("SYNCED");
    return;
  }
  useSyncStore.getState().setEstado("SYNCING");

  try {
    const resp = await apiFetch<{ resultados: { id: string; estado: string; error?: string }[] }>("/sync/push", {
      method: "POST",
      body: JSON.stringify({
        items: items.map((i) => ({
          id: i.localId,
          entidad: i.entidad,
          operacion: i.operacion,
          idempotencyKey: i.idempotencyKey,
          dispositivoId: i.dispositivoId,
          sucursalId: i.sucursalId,
          usuarioId: i.usuarioId,
          createdAtLocal: i.createdAt,
          payload: i.payload,
        })),
      }),
    });
    for (const r of resp.resultados) {
      if (r.estado === "SYNCED") await outbox.marcarSincronizado(r.id);
      else await outbox.marcarError(r.id, r.error ?? "Error desconocido");
    }
    useSyncStore.getState().setEstado("SYNCED");
  } catch {
    useSyncStore.getState().setEstado("OFFLINE");
  }
  await actualizarContador();
}

async function actualizarContador() {
  const n = await outbox.contarPendientes();
  useSyncStore.getState().setPendientes(n);
}
