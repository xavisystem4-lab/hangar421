import { create } from "zustand";
import type { AuthUserContext, RolUsuario } from "@hangar421/shared";
import { apiFetch, getTokens, setTokens } from "../api/http";

interface AuthState {
  usuario: AuthUserContext | null;
  sucursalId: string | null;
  rol: RolUsuario | null;
  dispositivoId: string | null;
  cargando: boolean;
  error: string | null;
  inicializar: () => Promise<void>;
  loginCredenciales: (email: string, password: string, sucursalId?: string) => Promise<void>;
  loginPin: (usuarioId: string, pin: string, sucursalId: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  usuario: null,
  sucursalId: null,
  rol: null,
  dispositivoId: null,
  cargando: true,
  error: null,

  inicializar: async () => {
    const dispositivoId = await window.hangar.deviceId();
    const sesion = getTokens();
    set({ dispositivoId });
    if (!sesion) {
      set({ cargando: false });
      return;
    }
    // La sesión persiste entre reinicios: se restaura el contexto de usuario/rol guardado localmente.
    const contexto = await window.hangar.config.obtener("sesion_usuario");
    if (contexto) {
      const { usuario, sucursalId, rol } = JSON.parse(contexto);
      set({ usuario, sucursalId, rol, cargando: false });
    } else {
      set({ cargando: false });
    }
  },

  loginCredenciales: async (email, password, sucursalId) => {
    set({ error: null });
    const { dispositivoId } = get();
    try {
      const resp = await apiFetch<any>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password, sucursalId, dispositivoId }),
      });
      await aplicarSesion(resp, set);
    } catch (e: any) {
      set({ error: e.message ?? "No se pudo iniciar sesión" });
      throw e;
    }
  },

  loginPin: async (usuarioId, pin, sucursalId) => {
    set({ error: null });
    const { dispositivoId } = get();
    try {
      const resp = await apiFetch<any>("/auth/login-pin", {
        method: "POST",
        body: JSON.stringify({ usuarioId, pin, sucursalId, dispositivoId }),
      });
      await aplicarSesion(resp, set);
    } catch (e: any) {
      set({ error: e.message ?? "PIN incorrecto" });
      throw e;
    }
  },

  logout: async () => {
    const sesion = getTokens();
    if (sesion) await apiFetch("/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken: sesion.refreshToken }) }).catch(() => undefined);
    setTokens(null);
    await window.hangar.config.guardar("sesion_usuario", "");
    set({ usuario: null, sucursalId: null, rol: null });
  },
}));

async function aplicarSesion(resp: any, set: (partial: Partial<AuthState>) => void) {
  setTokens({ accessToken: resp.accessToken, refreshToken: resp.refreshToken });
  // La sucursal/rol activos de la sesión van embebidos en el propio access token
  // (AuthService.emitirSesion los fija en el momento del login).
  const payload = decodificarJwt(resp.accessToken);
  const contexto = { usuario: resp.usuario, sucursalId: payload.sucursalId, rol: payload.rol };
  await window.hangar.config.guardar("sesion_usuario", JSON.stringify(contexto));
  set(contexto);
}

function decodificarJwt(token: string): { sucursalId: string; rol: RolUsuario } {
  const [, payloadB64] = token.split(".");
  return JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));
}
