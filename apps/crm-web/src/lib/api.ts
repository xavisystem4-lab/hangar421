"use client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000/api/v1";

function token(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("hangar421_crm_token");
}

function refreshTokenGuardado(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("hangar421_crm_refresh");
}

export function guardarToken(t: string) {
  localStorage.setItem("hangar421_crm_token", t);
}

export function guardarRefreshToken(t: string) {
  localStorage.setItem("hangar421_crm_refresh", t);
}

export function cerrarSesionLocal() {
  localStorage.removeItem("hangar421_crm_token");
  localStorage.removeItem("hangar421_crm_refresh");
  localStorage.removeItem("hangar421_crm_contexto");
}

// El access token dura 15 minutos (JWT_ACCESS_EXPIRES_IN del backend) — antes, en cuanto
// expiraba, CUALQUIER pantalla se quedaba en "Cargando…" para siempre: login() nunca guardaba
// el refreshToken que ya devuelve /auth/login, y apiFetch no hacía nada especial con un 401 más
// que lanzar el error (que las pantallas ya ni siquiera mostraban, solo dejaban su estado de
// carga en true). Reportado por el usuario como "no carga el módulo de Dashboard en la web" —
// en realidad afectaba a cualquier pantalla pasados los primeros 15 minutos de sesión.
//
// `refrescando` comparte una sola promesa en vuelo: el dashboard dispara varias llamadas casi
// juntas, y sin esto cada una dispararía su propio /auth/refresh en paralelo (el primero que
// llegue rota el refresh token en el backend — ver AuthService.refrescar — dejando al resto con
// un refresh token ya usado y una sesión que se cierra sola de rebote).
let refrescando: Promise<boolean> | null = null;

async function refrescarSesion(): Promise<boolean> {
  const rt = refreshTokenGuardado();
  if (!rt) return false;
  if (!refrescando) {
    refrescando = (async () => {
      try {
        const res = await fetch(`${API_URL}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken: rt }),
        });
        if (!res.ok) return false;
        const data = await res.json();
        guardarToken(data.accessToken);
        guardarRefreshToken(data.refreshToken);
        return true;
      } catch {
        return false;
      } finally {
        refrescando = null;
      }
    })();
  }
  return refrescando;
}

export async function apiFetch<T>(path: string, options: RequestInit = {}, _yaReintentado = false): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
      ...options.headers,
    },
  });

  if (res.status === 401 && !_yaReintentado && path !== "/auth/login" && path !== "/auth/refresh") {
    const ok = await refrescarSesion();
    if (ok) return apiFetch<T>(path, options, true);
    // El refresh también falló (expiró de verdad, o se cerró sesión en otro dispositivo) — la
    // sesión ya no es recuperable. Antes esto se quedaba como una excepción silenciosa con la
    // pantalla en "Cargando…"; ahora se limpia la sesión local y se manda a /login de una vez.
    cerrarSesionLocal();
    if (typeof window !== "undefined") window.location.href = "/login";
    throw new Error("Sesión expirada, vuelve a iniciar sesión.");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `Error ${res.status}`);
  }
  return res.json();
}

export { API_URL };
