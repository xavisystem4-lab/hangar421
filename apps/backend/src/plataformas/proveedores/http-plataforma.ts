import { timingSafeEqual } from "crypto";
import { PeticionWebhook } from "./plataforma-delivery.interface";

/**
 * Piezas comunes de los adaptadores de delivery: mensajes de error accionables (sin exponer
 * secretos, hosts ni trazas), caché de tokens OAuth y comparación de firmas.
 */

/** Traduce un status HTTP de la plataforma a algo que el administrador pueda resolver. */
export function mensajeErrorHttp(plataforma: string, status: number, accion = "la conexión"): string {
  if (status === 400) return `${plataforma} rechazó ${accion} (400): revisa el id de tienda y que la orden siga vigente.`;
  if (status === 401) return `${plataforma} rechazó las credenciales (401): revisa Client ID / Client Secret y el ambiente (Pruebas/Producción).`;
  if (status === 403) return `${plataforma} negó el permiso (403): la app no está aprobada para este alcance o esta tienda no la autorizó.`;
  if (status === 404) return `${plataforma} no encontró el recurso (404): revisa el id de tienda u orden.`;
  if (status === 409) return `${plataforma} reporta un conflicto (409): la orden ya cambió de estado en la plataforma.`;
  if (status === 429) return `${plataforma} limitó las peticiones (429): espera un minuto y vuelve a intentar.`;
  if (status >= 500) return `${plataforma} tuvo un error interno (${status}): vuelve a intentar en unos minutos.`;
  return `${plataforma} respondió ${status} al intentar ${accion}.`;
}

/** Error de red/timeout sin repetir `e.message` (puede traer hosts o detalles internos). */
export function mensajeErrorRed(plataforma: string, e: unknown): string {
  const nombre = (e as { name?: string } | undefined)?.name ?? "";
  if (/Abort|Timeout/i.test(nombre) || /timeout|tiempo/i.test(String((e as any)?.message ?? ""))) {
    return `${plataforma} no respondió a tiempo: revisa la conexión a internet del servidor e intenta de nuevo.`;
  }
  return `No se pudo contactar a ${plataforma}: revisa la conexión del servidor o la URL configurada.`;
}

/** Bytes sobre los que la plataforma calculó la firma. */
export function cuerpoParaFirma(peticion: PeticionWebhook): string {
  if (typeof peticion.rawBody === "string") return peticion.rawBody;
  if (typeof peticion.body === "string") return peticion.body;
  return JSON.stringify(peticion.body ?? {});
}

export function firmasIguales(esperada: string, recibida: string): boolean {
  const a = Buffer.from(esperada.toLowerCase());
  const b = Buffer.from(recibida.trim().toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Caché de tokens OAuth por credencial. Uber invalida el token más viejo si se piden muchos
 * (límite por hora) y Rappi los da con vigencia de días: pedir uno por llamada sería un error.
 * Vive en memoria del proceso — un reinicio del backend solo provoca pedir uno nuevo.
 */
export class CacheTokens {
  private readonly tokens = new Map<string, { valor: string; venceEn: number }>();

  async obtener(clave: string, pedir: () => Promise<{ token: string; expiraEnSegundos: number }>): Promise<string> {
    const actual = this.tokens.get(clave);
    if (actual && actual.venceEn > Date.now()) return actual.valor;
    const nuevo = await pedir();
    // Margen de 5 minutos para no usar un token a punto de vencer.
    const vigenciaMs = Math.max(60, nuevo.expiraEnSegundos - 300) * 1000;
    this.tokens.set(clave, { valor: nuevo.token, venceEn: Date.now() + vigenciaMs });
    return nuevo.token;
  }

  invalidar(clave: string) {
    this.tokens.delete(clave);
  }
}

/** Error con un mensaje ya apto para mostrarse al administrador. */
export class ErrorPlataforma extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorPlataforma";
  }
}

export function numeroONull(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}
