import AsyncStorage from "@react-native-async-storage/async-storage";
import { obtenerApiUrl } from "../store/conexionStore";

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

let tokensCache: Tokens | null = null;

export async function cargarTokens(): Promise<Tokens | null> {
  if (tokensCache) return tokensCache;
  const raw = await AsyncStorage.getItem("hangar421_tokens");
  tokensCache = raw ? JSON.parse(raw) : null;
  return tokensCache;
}

export async function setTokens(t: Tokens | null) {
  tokensCache = t;
  if (t) await AsyncStorage.setItem("hangar421_tokens", JSON.stringify(t));
  else await AsyncStorage.removeItem("hangar421_tokens");
}

export async function apiFetch<T>(path: string, options: RequestInit = {}, reintentar = true): Promise<T> {
  const tokens = await cargarTokens();
  const res = await fetch(`${obtenerApiUrl()}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(tokens ? { Authorization: `Bearer ${tokens.accessToken}` } : {}),
      ...options.headers,
    },
  });

  if (res.status === 401 && reintentar && tokens) {
    const ok = await intentarRefrescar(tokens);
    if (ok) return apiFetch<T>(path, options, false);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `Error ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

async function intentarRefrescar(tokens: Tokens): Promise<boolean> {
  try {
    const res = await fetch(`${obtenerApiUrl()}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: tokens.refreshToken }),
    });
    if (!res.ok) throw new Error("refresh falló");
    const data = await res.json();
    await setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
    return true;
  } catch {
    await setTokens(null);
    return false;
  }
}
