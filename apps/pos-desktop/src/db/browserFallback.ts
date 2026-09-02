/**
 * Shim de `window.hangar` respaldado por localStorage, usado solo cuando la app corre en un
 * navegador normal (sin el preload de Electron) — por ejemplo, para previsualizar la UI con
 * `npm run dev -- --host` sin abrir la ventana de Electron. En producción (Electron) el
 * preload real (electron/preload.ts) siempre sobreescribe `window.hangar` con la versión
 * respaldada por SQLite; este shim nunca se usa fuera de desarrollo.
 */
function leer<T>(clave: string, porDefecto: T): T {
  try {
    const raw = localStorage.getItem(clave);
    return raw ? JSON.parse(raw) : porDefecto;
  } catch {
    return porDefecto;
  }
}

function escribir(clave: string, valor: unknown) {
  localStorage.setItem(clave, JSON.stringify(valor));
}

export function instalarFallbackNavegador() {
  if (typeof window === "undefined" || (window as any).hangar) return;

  (window as any).hangar = {
    deviceId: async () => {
      let id = leer<string | null>("hangar421_fallback_device", null);
      if (!id) {
        id = crypto.randomUUID();
        escribir("hangar421_fallback_device", id);
      }
      return id;
    },
    outbox: {
      encolar: async (item: any) => {
        const items = leer<any[]>("hangar421_fallback_outbox", []);
        items.push({ ...item, estado: "PENDING", created_at: new Date().toISOString() });
        escribir("hangar421_fallback_outbox", items);
      },
      pendientes: async () => leer<any[]>("hangar421_fallback_outbox", []).filter((i) => i.estado !== "SYNCED"),
      marcarSincronizado: async (localId: string) => {
        const items = leer<any[]>("hangar421_fallback_outbox", []);
        escribir("hangar421_fallback_outbox", items.map((i) => (i.localId === localId ? { ...i, estado: "SYNCED" } : i)));
      },
      marcarError: async (localId: string, error: string) => {
        const items = leer<any[]>("hangar421_fallback_outbox", []);
        escribir("hangar421_fallback_outbox", items.map((i) => (i.localId === localId ? { ...i, estado: "ERROR", ultimo_error: error } : i)));
      },
      contarPendientes: async () => leer<any[]>("hangar421_fallback_outbox", []).filter((i) => i.estado !== "SYNCED").length,
    },
    cache: {
      guardar: async (coleccion: string, id: string, data: unknown) => {
        const cache = leer<Record<string, unknown>>(`hangar421_fallback_cache_${coleccion}`, {});
        cache[id] = data;
        escribir(`hangar421_fallback_cache_${coleccion}`, cache);
      },
      listar: async (coleccion: string) => Object.values(leer<Record<string, unknown>>(`hangar421_fallback_cache_${coleccion}`, {})),
    },
    config: {
      obtener: async (clave: string) => leer<string | null>(`hangar421_fallback_config_${clave}`, null),
      guardar: async (clave: string, valor: string) => escribir(`hangar421_fallback_config_${clave}`, valor),
    },

    // en navegador (sin Electron) no hay auto-actualización real: se simula "al día"
    // para que el footer se pueda desarrollar/depurar sin necesitar la app empaquetada.
    appVersion: async () => "0.0.0-dev",
    // en navegador (sin Electron) no hay backend embebido: el renderer cae a VITE_API_URL.
    backend: {
      obtenerUrl: async () => null,
      onEstado: () => () => undefined,
    },
    updater: {
      verificar: async () => undefined,
      instalar: async () => undefined,
      onEvento: () => () => undefined,
    },
  };
}
