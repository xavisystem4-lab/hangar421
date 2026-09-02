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
