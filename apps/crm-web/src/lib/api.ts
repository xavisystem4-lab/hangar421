"use client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000/api/v1";

function token(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("hangar421_crm_token");
}

export function guardarToken(t: string) {
  localStorage.setItem("hangar421_crm_token", t);
}

export function cerrarSesionLocal() {
  localStorage.removeItem("hangar421_crm_token");
  localStorage.removeItem("hangar421_crm_contexto");
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

export { API_URL };
