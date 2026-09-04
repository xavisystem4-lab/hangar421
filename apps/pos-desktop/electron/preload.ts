import { contextBridge, ipcRenderer } from "electron";

/** Puente seguro entre el renderer (React, sin acceso a Node) y el proceso principal
 *  (dueño de la base SQLite local). Ver docs/sync-flows.md. */
contextBridge.exposeInMainWorld("hangar", {
  deviceId: (): Promise<string> => ipcRenderer.invoke("device:id"),

  outbox: {
    encolar: (item: unknown) => ipcRenderer.invoke("outbox:encolar", item),
    pendientes: (limite = 200) => ipcRenderer.invoke("outbox:pendientes", limite),
    marcarSincronizado: (localId: string) => ipcRenderer.invoke("outbox:marcarSincronizado", localId),
    marcarError: (localId: string, error: string) => ipcRenderer.invoke("outbox:marcarError", localId, error),
    contarPendientes: (): Promise<number> => ipcRenderer.invoke("outbox:contarPendientes"),
  },

  cache: {
    guardar: (coleccion: string, id: string, data: unknown) => ipcRenderer.invoke("cache:guardar", coleccion, id, data),
    listar: (coleccion: string) => ipcRenderer.invoke("cache:listar", coleccion),
  },

  config: {
    obtener: (clave: string): Promise<string | null> => ipcRenderer.invoke("config:obtener", clave),
    guardar: (clave: string, valor: string) => ipcRenderer.invoke("config:guardar", clave, valor),
  },

  appVersion: (): Promise<string> => ipcRenderer.invoke("app:version"),

  backend: {
    /** Resuelve cuando el backend (embebido o cloud configurado) está listo — puede tardar
     *  unos segundos la primera vez (crea la base de datos local). null en dev (usa VITE_API_URL). */
    obtenerUrl: (): Promise<string | null> => ipcRenderer.invoke("backend:obtenerUrl"),
    /** IP LAN de esta PC (o la que el admin haya guardado a mano) + puerto REAL en el que el
     *  backend ya está escuchando + puerto preferido guardado (puede diferir del real si ese
     *  puerto ya estaba ocupado al arrancar) — el dato que hay que capturar en el módulo de
     *  conexión de la app de Meseros. Todo null si esta instalación usa backend cloud (no aplica
     *  un IP:puerto local) — ver AdminConexion.tsx. */
    obtenerInfoConexion: (): Promise<{ ip: string | null; puerto: number | null; puertoPreferido: number | null }> =>
      ipcRenderer.invoke("backend:obtenerInfoConexion"),
    /** Guarda un override manual de IP y/o del puerto preferido — ip vacía o puertoPreferido<=0
     *  borra ese override (vuelve a automático/3000). El puerto preferido solo aplica en el
     *  próximo arranque del backend (no se puede recolocar un puerto ya bindeado). */
    guardarInfoConexion: (ip: string, puertoPreferido: number): Promise<void> =>
      ipcRenderer.invoke("backend:guardarInfoConexion", ip, puertoPreferido),
    onEstado: (callback: (mensaje: string) => void) => {
      const handler = (_e: unknown, mensaje: string) => callback(mensaje);
      ipcRenderer.on("backend:estado", handler);
      return () => ipcRenderer.removeListener("backend:estado", handler);
    },
  },

  updater: {
    verificar: () => ipcRenderer.invoke("updater:verificar"),
    instalar: () => ipcRenderer.invoke("updater:instalar"),
    onEvento: (callback: (evento: { tipo: string; data?: unknown }) => void) => {
      const handler = (_e: unknown, evento: { tipo: string; data?: unknown }) => callback(evento);
      ipcRenderer.on("updater:evento", handler);
      return () => ipcRenderer.removeListener("updater:evento", handler);
    },
  },
});
