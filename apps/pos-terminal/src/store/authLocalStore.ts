import { create } from "zustand";
import { abrirBaseDeDatos } from "../db/database";
import { listarUsuariosLocales, validarPinLocal, type UsuarioLocal } from "../db/usuariosLocalesRepo";

interface AuthLocalState {
  usuario: UsuarioLocal | null;
  usuariosDisponibles: UsuarioLocal[];
  cargando: boolean;
  error: string | null;
  cargarUsuarios: () => Promise<void>;
  entrar: (usuarioLocalId: string, pin: string) => Promise<void>;
  salir: () => void;
}

/** Sesión LOCAL, sin JWT de larga duración — a propósito (ver Decisión #3 del plan): no hay un
 *  token robable que sobreviva el cierre de la app. Cada apertura pide PIN de nuevo y lo valida
 *  contra `pin_cache` (100% offline, ver validarPinLocal). El estado de sesión solo vive en
 *  memoria durante el proceso; no se persiste en AsyncStorage/SQLite. */
export const useAuthLocalStore = create<AuthLocalState>((set, get) => ({
  usuario: null,
  usuariosDisponibles: [],
  cargando: true,
  error: null,

  cargarUsuarios: async () => {
    const db = await abrirBaseDeDatos();
    const usuarios = await listarUsuariosLocales(db);
    set({ usuariosDisponibles: usuarios, cargando: false });
  },

  entrar: async (usuarioLocalId, pin) => {
    set({ error: null });
    const db = await abrirBaseDeDatos();
    const valido = await validarPinLocal(db, usuarioLocalId, pin);
    if (!valido) {
      set({ error: "PIN incorrecto" });
      throw new Error("PIN incorrecto");
    }
    const usuario = get().usuariosDisponibles.find((u) => u.id === usuarioLocalId) ?? null;
    set({ usuario });
  },

  salir: () => set({ usuario: null }),
}));
