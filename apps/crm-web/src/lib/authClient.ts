"use client";

import { create } from "zustand";
import type { AuthUserContext } from "@hangar421/shared";
import { apiFetch, cerrarSesionLocal, guardarToken } from "./api";

interface Contexto {
  usuario: AuthUserContext;
  sucursalId: string;
  rol: string;
}

interface AuthState {
  contexto: Contexto | null;
  cargando: boolean;
  error: string | null;
  inicializar: () => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

export const useAuthCrm = create<AuthState>((set) => ({
  contexto: null,
  cargando: true,
  error: null,

  inicializar: () => {
    if (typeof window === "undefined") return;
    const raw = localStorage.getItem("hangar421_crm_contexto");
    set({ contexto: raw ? JSON.parse(raw) : null, cargando: false });
  },

  login: async (email, password) => {
    set({ error: null });
    try {
      const resp = await apiFetch<any>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      guardarToken(resp.accessToken);
      const payload = JSON.parse(atob(resp.accessToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      const contexto: Contexto = { usuario: resp.usuario, sucursalId: payload.sucursalId, rol: payload.rol };
      localStorage.setItem("hangar421_crm_contexto", JSON.stringify(contexto));
      set({ contexto });
    } catch (e: any) {
      set({ error: e.message ?? "No se pudo iniciar sesión" });
      throw e;
    }
  },

  logout: () => {
    cerrarSesionLocal();
    set({ contexto: null });
  },
}));
