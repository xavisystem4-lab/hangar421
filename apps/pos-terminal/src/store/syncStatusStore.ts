import { create } from "zustand";

export type EstadoSync = "SIN_CONEXION" | "PENDIENTE" | "SINCRONIZADO" | "ERROR";

interface SyncStatusState {
  estado: EstadoSync;
  pendientes: number;
  ultimoError: string | null;
  sincronizando: boolean;
  /** Distinto de `estado === "SIN_CONEXION"`: ese puede ser un dispositivo YA conectado que
   *  ahora mismo no tiene red; `conectadoAlErp` es si alguna vez se guardaron tokens (ver
   *  ConexionErpScreen) — sirve para decidir si tocar el indicador debe ofrecer "conectar" o
   *  "ver detalle/sincronizar ahora". */
  conectadoAlErp: boolean;
  setEstado: (estado: EstadoSync) => void;
  setPendientes: (n: number) => void;
  setUltimoError: (mensaje: string | null) => void;
  setSincronizando: (v: boolean) => void;
  setConectadoAlErp: (v: boolean) => void;
}

/** Indicador visible de 4 estados (ver plan, Parte B "Sincronización"): Sin conexión / Pendiente
 *  de sincronizar / Sincronizado / Error — nunca bloquea ni retrasa una venta, solo informa. */
export const useSyncStatusStore = create<SyncStatusState>((set) => ({
  estado: "SIN_CONEXION",
  pendientes: 0,
  ultimoError: null,
  sincronizando: false,
  conectadoAlErp: false,
  setEstado: (estado) => set({ estado }),
  setPendientes: (pendientes) => set({ pendientes }),
  setUltimoError: (ultimoError) => set({ ultimoError }),
  setSincronizando: (sincronizando) => set({ sincronizando }),
  setConectadoAlErp: (conectadoAlErp) => set({ conectadoAlErp }),
}));
