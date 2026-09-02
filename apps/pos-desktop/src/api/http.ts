const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000/api/v1";

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

let tokens: Tokens | null = JSON.parse(localStorage.getItem("hangar421_tokens") ?? "null");

export function setTokens(t: Tokens | null) {
  tokens = t;
  if (t) localStorage.setItem("hangar421_tokens", JSON.stringify(t));
  else localStorage.removeItem("hangar421_tokens");
}

export function getTokens() {
  return tokens;
}

/** Cliente HTTP con refresh automático del access token ante un 401. */
export async function apiFetch<T>(path: string, options: RequestInit = {}, reintentar = true): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(tokens ? { Authorization: `Bearer ${tokens.accessToken}` } : {}),
      ...options.headers,
    },
  });

  if (res.status === 401 && reintentar && tokens) {
    const refrescado = await intentarRefrescar();
    if (refrescado) return apiFetch<T>(path, options, false);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `Error ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

async function intentarRefrescar(): Promise<boolean> {
  if (!tokens) return false;
  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: tokens.refreshToken }),
    });
    if (!res.ok) throw new Error("refresh falló");
    const data = await res.json();
    setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
    return true;
  } catch {
    setTokens(null);
    return false;
  }
}

export { API_URL };
