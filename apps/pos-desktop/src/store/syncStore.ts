import { create } from "zustand";

export type EstadoSync = "SYNCED" | "SYNCING" | "PENDING" | "ERROR" | "OFFLINE";

interface SyncState {
  estado: EstadoSync;
  pendientes: number;
  ultimoError: string | null;
  setEstado: (estado: EstadoSync) => void;
  setPendientes: (n: number) => void;
  setError: (msg: string | null) => void;
}

export const useSyncStore = create<SyncState>((set) => ({
  estado: "SYNCED",
  pendientes: 0,
  ultimoError: null,
  setEstado: (estado) => set({ estado }),
  setPendientes: (pendientes) => set({ pendientes }),
  setError: (ultimoError) => set({ ultimoError }),
}));
