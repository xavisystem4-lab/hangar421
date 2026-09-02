const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000/api/v1";

function token(): string | null {
  return localStorage.getItem("hangar421_kds_token");
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `Error ${res.status}`);
  }
  return res.json();
}

export function guardarSesion(accessToken: string) {
  localStorage.setItem("hangar421_kds_token", accessToken);
}

export function cerrarSesion() {
  localStorage.removeItem("hangar421_kds_token");
}

export { API_URL };
