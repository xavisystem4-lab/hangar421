/**
 * `fetch()` con timeout y reintentos con backoff exponencial — infraestructura genérica para
 * cualquier adaptador que llame a una API externa (hoy: plataformas de delivery). No existía
 * nada así en el repo (mercadopago.adapter.ts usa `fetch()` a pelo, sin timeout ni reintento) —
 * se agrega aquí, no dentro de `plataformas/`, porque cualquier otro módulo que hable con una API
 * externa puede reutilizarlo.
 *
 * Nunca reintenta un 4xx "normal" (credenciales inválidas, payload mal formado, etc. — reintentar
 * no lo arregla) salvo 429 (rate limit, sí vale la pena esperar y reintentar). Sí reintenta
 * errores de red/timeout y 5xx.
 */

export class ErrorFetchConReintentos extends Error {
  constructor(mensaje: string, readonly causaOriginal?: unknown) {
    super(mensaje);
    this.name = "ErrorFetchConReintentos";
  }
}

export interface OpcionesFetchConReintentos {
  /** Tiempo máximo por intento antes de abortar. Default 8000ms. */
  timeoutMs?: number;
  /** Reintentos adicionales tras el primer intento (2 = 3 intentos totales). Default 2. */
  reintentos?: number;
  /** Base del backoff exponencial en ms (base * 2^intento + jitter). Default 300. */
  backoffBaseMs?: number;
  /** Decide si un resultado amerita reintentar. Default: error de red/timeout, status >= 500, o 429. */
  reintentarSi?: (res: Response | null, error: unknown) => boolean;
}

function reintentarPorDefecto(res: Response | null, _error: unknown): boolean {
  if (!res) return true; // error de red o timeout
  return res.status >= 500 || res.status === 429;
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchConReintentos(
  url: string,
  init: RequestInit,
  opciones: OpcionesFetchConReintentos = {},
): Promise<Response> {
  const timeoutMs = opciones.timeoutMs ?? 8000;
  const reintentosMax = opciones.reintentos ?? 2;
  const backoffBaseMs = opciones.backoffBaseMs ?? 300;
  const reintentarSi = opciones.reintentarSi ?? reintentarPorDefecto;

  let ultimoError: unknown;
  let ultimaRespuesta: Response | null = null;

  for (let intento = 0; intento <= reintentosMax; intento++) {
    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controlador.signal });
      clearTimeout(temporizador);
      if (res.ok || !reintentarSi(res, null) || intento === reintentosMax) {
        return res;
      }
      ultimaRespuesta = res;
    } catch (e: any) {
      clearTimeout(temporizador);
      ultimoError = e;
      const esAbort = e?.name === "AbortError";
      const error = esAbort ? new ErrorFetchConReintentos(`Tiempo de espera agotado (${timeoutMs}ms)`, e) : e;
      if (!reintentarSi(null, error) || intento === reintentosMax) {
        throw new ErrorFetchConReintentos(
          `${url} falló tras ${intento + 1} intento(s): ${esAbort ? "tiempo de espera agotado" : error.message}`,
          error,
        );
      }
      ultimoError = error;
    }
    await esperar(backoffBaseMs * 2 ** intento + Math.random() * backoffBaseMs);
  }

  // Solo se llega aquí si se agotaron los reintentos tras respuestas no-ok (nunca tras un throw,
  // que ya retorna/lanza dentro del loop).
  if (ultimaRespuesta) return ultimaRespuesta;
  throw new ErrorFetchConReintentos(`${url} falló tras ${reintentosMax + 1} intento(s)`, ultimoError);
}
