import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import type { AuthUserContext } from "@hangar421/shared";
import { apiFetch, setTokens } from "../api/http";
import { obtenerOCrearDeviceId } from "../db/outbox";

interface AuthState {
  usuario: AuthUserContext | null;
  sucursalId: string | null;
  rol: string | null;
  dispositivoId: string | null;
  cargando: boolean;
  error: string | null;
  inicializar: () => Promise<void>;
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
    const dispositivoId = await obtenerOCrearDeviceId();
    const raw = await AsyncStorage.getItem("hangar421_sesion");
    if (raw) {
      const { usuario, sucursalId, rol } = JSON.parse(raw);
      set({ usuario, sucursalId, rol, dispositivoId, cargando: false });
    } else {
      set({ dispositivoId, cargando: false });
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
      await setTokens({ accessToken: resp.accessToken, refreshToken: resp.refreshToken });
      const payload = decodificarJwt(resp.accessToken);
      const contexto = { usuario: resp.usuario, sucursalId: payload.sucursalId, rol: payload.rol };
      await AsyncStorage.setItem("hangar421_sesion", JSON.stringify(contexto));
      set(contexto);
    } catch (e: any) {
      set({ error: e.message ?? "PIN incorrecto" });
      throw e;
    }
  },

  logout: async () => {
    await setTokens(null);
    await AsyncStorage.removeItem("hangar421_sesion");
    set({ usuario: null, sucursalId: null, rol: null });
  },
}));

/** Decodifica el payload de un JWT sin depender de `atob` (no siempre disponible en Hermes/RN). */
function decodificarJwt(token: string): { sucursalId: string; rol: string } {
  const [, payloadB64] = token.split(".");
  const normalizado = payloadB64.replace(/-/g, "+").replace(/_/g, "/").padEnd(payloadB64.length + ((4 - (payloadB64.length % 4)) % 4), "=");
  const binario = base64Decode(normalizado);
  return JSON.parse(binario);
}

const ALFABETO_B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64Decode(input: string): string {
  let salida = "";
  let buffer = 0;
  let bits = 0;
  for (const char of input.replace(/=+$/, "")) {
    buffer = (buffer << 6) | ALFABETO_B64.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      salida += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  // decodifica UTF-8 a partir de los bytes reconstruidos
  return decodeURIComponent(
    salida
      .split("")
      .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
      .join(""),
  );
}
