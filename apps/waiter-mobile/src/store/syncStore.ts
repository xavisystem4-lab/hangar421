import { create } from "zustand";

export type EstadoSync = "SYNCED" | "SYNCING" | "OFFLINE";

interface SyncState {
  estado: EstadoSync;
  pendientes: number;
  setEstado: (e: EstadoSync) => void;
  setPendientes: (n: number) => void;
}

export const useSyncStore = create<SyncState>((set) => ({
  estado: "SYNCED",
  pendientes: 0,
  setEstado: (estado) => set({ estado }),
  setPendientes: (pendientes) => set({ pendientes }),
}));
