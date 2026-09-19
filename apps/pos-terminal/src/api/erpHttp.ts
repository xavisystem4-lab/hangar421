import Constants from "expo-constants";
import { abrirBaseDeDatos } from "../db/database";
import { obtenerConfig, guardarConfig } from "../db/configLocalRepo";

const CLAVE_BASE_URL = "erp_base_url";
const CLAVE_ACCESS_TOKEN = "erp_access_token";
const CLAVE_REFRESH_TOKEN = "erp_refresh_token";

// Mismo criterio defensivo que apps/waiter-mobile/src/api/http.ts: sin timeout, un `fetch`
// contra un backend en la nube inalcanzable (no un rechazo activo, un simple "nadie responde")
// puede quedarse colgado mucho más de lo razonable sin resolver ni rechazar la promesa.
const TIMEOUT_MS = 10_000;

/** Error del ERP que conserva el cuerpo de la respuesta, no solo el mensaje.
 *
 *  Hace falta porque algunos errores llevan datos que el cliente necesita para recuperarse: el
 *  400 `SUCURSAL_REQUERIDA` del login trae la lista de sucursales a las que el usuario puede
 *  entrar, y es la ÚNICA forma de obtenerla — en ese punto todavía no hay token con el que
 *  consultarla. Ver `AuthService.resolverSucursalActiva` en el backend.
 *
 *  Sigue siendo un Error normal, así que todo lo que ya hacía `catch (e) { e.message }` funciona
 *  igual. */
export class ErrorErp extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly cuerpo: any,
  ) {
    super(message);
    this.name = "ErrorErp";
  }

  /** Código de negocio del backend (`codigo` en el cuerpo), si lo trae. */
  get codigo(): string | undefined {
    return this.cuerpo?.codigo;
  }
}

export async function obtenerErpBaseUrl(): Promise<string> {
  const db = await abrirBaseDeDatos();
  const guardada = await obtenerConfig(db, CLAVE_BASE_URL);
  return guardada ?? (Constants.expoConfig?.extra?.erpApiUrl as string) ?? "https://hangar421backend-production.up.railway.app/api/v1";
}

export async function guardarTokensErp(accessToken: string, refreshToken: string): Promise<void> {
  const db = await abrirBaseDeDatos();
  await guardarConfig(db, CLAVE_ACCESS_TOKEN, accessToken);
  await guardarConfig(db, CLAVE_REFRESH_TOKEN, refreshToken);
}

export async function obtenerTokensErp(): Promise<{ accessToken: string; refreshToken: string } | null> {
  const db = await abrirBaseDeDatos();
  const [accessToken, refreshToken] = await Promise.all([obtenerConfig(db, CLAVE_ACCESS_TOKEN), obtenerConfig(db, CLAVE_REFRESH_TOKEN)]);
  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken };
}

/** apiFetch contra el ERP (opcional por diseño — nunca se llama desde el flujo de venta, solo
 *  desde el motor de sync en segundo plano y la pantalla de conexión). Igual patrón que
 *  apps/waiter-mobile/src/api/http.ts: timeout + refresh-on-401, con la diferencia de que aquí
 *  un fallo NUNCA debe propagarse hacia una pantalla de venta — solo lo usan syncEngine.ts y
 *  ConexionErpScreen.tsx, ambos ya preparados para fallar en silencio/mostrar el indicador de
 *  estado en vez de bloquear nada. */
export async function erpFetch<T>(path: string, options: RequestInit = {}, reintentar = true): Promise<T> {
  const baseUrl = await obtenerErpBaseUrl();
  const tokens = await obtenerTokensErp();
  const controlador = new AbortController();
  const limite = setTimeout(() => controlador.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      ...options,
      signal: controlador.signal,
      headers: {
        "Content-Type": "application/json",
        ...(tokens ? { Authorization: `Bearer ${tokens.accessToken}` } : {}),
        ...options.headers,
      },
    });
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error("network timeout: el ERP no respondió a tiempo");
    throw e;
  } finally {
    clearTimeout(limite);
  }

  if (res.status === 401 && reintentar && tokens) {
    const ok = await intentarRefrescar(tokens.refreshToken, baseUrl);
    if (ok) return erpFetch<T>(path, options, false);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ErrorErp(body.message ?? `Error ${res.status}`, res.status, body);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

async function intentarRefrescar(refreshToken: string, baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) throw new Error("refresh falló");
    const data = await res.json();
    await guardarTokensErp(data.accessToken, data.refreshToken);
    return true;
  } catch {
    return false;
  }
}
