"use client";

import { create } from "zustand";
import type { AuthUserContext } from "@hangar421/shared";
import { apiFetch, cerrarSesionLocal, guardarRefreshToken, guardarToken } from "./api";

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
      guardarRefreshToken(resp.refreshToken);
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
    // Se borra también la sucursal activa: la siguiente persona que entre en este equipo debe
    // elegirla a conciencia, no heredar el contexto de quien lo usó antes.
    if (typeof window !== "undefined") localStorage.removeItem("hangar421_crm_sucursal_activa");
    set({ contexto: null });
  },
}));
