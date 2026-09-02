import { SYNC_DEFAULTS } from "@hangar421/shared";
import { apiFetch } from "../api/http";
import { useAuthStore } from "../store/authStore";
import { useSyncStore } from "../store/syncStore";

interface EnvelopeLike {
  id: string;
  entidad: string;
  operacion: "CREATE" | "UPDATE" | "DELETE";
  entidadId: string;
  idempotencyKey: string;
  payload: unknown;
}

/**
 * Ejecuta una acción de negocio contra el backend; si falla por conectividad (no por un error
 * de validación/negocio), la encola en el outbox local en vez de perder la operación.
 * Este es el mecanismo central del offline-first: la UI nunca espera a la nube para confirmar.
 */
export async function encolarSyncSiFalla<T>(intentoOnline: () => Promise<T>, item: EnvelopeLike): Promise<T | void> {
  try {
    const resultado = await intentoOnline();
    return resultado;
  } catch (e: any) {
    const esErrorDeRed = e instanceof TypeError || e?.message?.includes("fetch") || !navigator.onLine;
    if (!esErrorDeRed) throw e; // errores de negocio (400/403) no se encolan, se muestran al usuario

    const auth = useAuthStore.getState();
    await window.hangar.outbox.encolar({
      localId: item.id,
      entidad: item.entidad,
      operacion: item.operacion,
      entidadId: item.entidadId,
      idempotencyKey: item.idempotencyKey,
      sucursalId: auth.sucursalId,
      dispositivoId: auth.dispositivoId,
      usuarioId: auth.usuario?.id,
      payload: item.payload,
    });
    await actualizarContadorPendientes();
  }
}

let intervaloId: ReturnType<typeof setInterval> | null = null;

export function iniciarMotorDeSincronizacion() {
  if (intervaloId) return;
  procesarColaSalida();
  actualizarContadorPendientes();
  intervaloId = setInterval(() => {
    procesarColaSalida();
  }, 8_000);

  window.addEventListener("online", procesarColaSalida);
}

export function detenerMotorDeSincronizacion() {
  if (intervaloId) clearInterval(intervaloId);
  intervaloId = null;
  window.removeEventListener("online", procesarColaSalida);
}

/** Vacía la cola de salida hacia /sync/push, con idempotencia (id + idempotencyKey) —
 *  reintentar un lote ya aplicado no duplica nada en el servidor. */
export async function procesarColaSalida() {
  const auth = useAuthStore.getState();
  if (!auth.sucursalId || !navigator.onLine) {
    useSyncStore.getState().setEstado(navigator.onLine ? "SYNCED" : "OFFLINE");
    return;
  }

  const pendientes = await window.hangar.outbox.pendientes(SYNC_DEFAULTS.BATCH_MAX_ITEMS);
  if (pendientes.length === 0) {
    useSyncStore.getState().setEstado("SYNCED");
    return;
  }

  useSyncStore.getState().setEstado("SYNCING");
  const items = pendientes.map((p: any) => ({
    id: p.local_id,
    entidad: p.entidad,
    operacion: p.operacion,
    idempotencyKey: p.idempotency_key,
    dispositivoId: p.dispositivo_id,
    sucursalId: p.sucursal_id,
    usuarioId: p.usuario_id ?? undefined,
    createdAtLocal: p.created_at,
    payload: JSON.parse(p.payload),
  }));

  try {
    const resp = await apiFetch<{ resultados: { id: string; estado: string; error?: string }[] }>(
      "/sync/push",
      { method: "POST", body: JSON.stringify({ items }) },
    );
    for (const r of resp.resultados) {
      if (r.estado === "SYNCED") await window.hangar.outbox.marcarSincronizado(r.id);
      else await window.hangar.outbox.marcarError(r.id, r.error ?? "Error desconocido");
    }
    useSyncStore.getState().setEstado("SYNCED");
    useSyncStore.getState().setError(null);
  } catch (e: any) {
    useSyncStore.getState().setEstado("ERROR");
    useSyncStore.getState().setError(e.message ?? "Error de sincronización");
  }
  await actualizarContadorPendientes();
}

async function actualizarContadorPendientes() {
  const n = await window.hangar.outbox.contarPendientes();
  useSyncStore.getState().setPendientes(n);
  if (n > 0 && useSyncStore.getState().estado === "SYNCED") {
    useSyncStore.getState().setEstado("PENDING");
  }
}
