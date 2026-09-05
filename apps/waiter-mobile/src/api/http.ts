import AsyncStorage from "@react-native-async-storage/async-storage";
import { obtenerApiUrl } from "../store/conexionStore";

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

let tokensCache: Tokens | null = null;

// Sin esto, un `fetch` contra una IP mal escrita o inalcanzable (no un rechazo activo de
// conexión, sino un simple "nadie responde" — la Estación apagada, la tablet en otra red,
// un firewall que dropea el paquete) puede quedarse colgado 60s o más sin resolver ni
// rechazar la promesa: ni error, ni éxito, nada — el pedido nunca cae en encolarSyncSiFalla()
// (syncEngine.ts) porque esa función solo reacciona a una excepción, y aquí no había ninguna
// hasta que el OS decidiera rendirse. El mesero veía el botón "Enviar pedido" pegado sin
// ninguna señal de qué pasó. Mismo criterio de timeout que ya usa conexionStore.verificar().
const TIMEOUT_MS = 8_000;

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
  const controlador = new AbortController();
  const limite = setTimeout(() => controlador.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${obtenerApiUrl()}${path}`, {
      ...options,
      signal: controlador.signal,
      headers: {
        "Content-Type": "application/json",
        ...(tokens ? { Authorization: `Bearer ${tokens.accessToken}` } : {}),
        ...options.headers,
      },
    });
  } catch (e: any) {
    // Un abort por timeout llega como AbortError, no como TypeError — se normaliza el mensaje
    // para que encolarSyncSiFalla() (syncEngine.ts) lo reconozca como error de red y encole el
    // pedido en vez de perderlo.
    if (e?.name === "AbortError") throw new Error("network timeout: la Estación no respondió a tiempo");
    throw e;
  } finally {
    clearTimeout(limite);
  }

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
