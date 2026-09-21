/**
 * Cliente HTTP del POS hacia el ERP en la nube, con la sesión de la terminal.
 *
 * El access token vive solo en memoria; el refresh token lo guarda el servicio (cifrado). Ante un
 * 401 se renueva una vez y se reintenta. La nube ROTA el refresh token en cada renovación y revoca
 * el anterior, así que el nuevo se entrega a `guardarRefresh` de inmediato: perderlo obligaría a
 * vincular el POS otra vez con un código nuevo. `fetch` es el nativo de Node 20 (sin dependencias).
 */
export class ErrorNube extends Error {
  constructor(
    public readonly status: number,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

export class ClienteNube {
  private accessToken: string | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly obtenerRefresh: () => Promise<string>,
    private readonly guardarRefresh: (refreshToken: string) => Promise<void>,
    accessInicial?: string,
  ) {
    this.accessToken = accessInicial ?? null;
  }

  async llamar<T>(ruta: string, opciones: { metodo?: string; cuerpo?: unknown } = {}): Promise<T> {
    if (!this.accessToken) await this.renovar();
    let r = await this.enviar(ruta, opciones);
    if (r.status === 401) {
      await this.renovar();
      r = await this.enviar(ruta, opciones);
    }
    const texto = await r.text();
    if (!r.ok) throw new ErrorNube(r.status, extraerMensaje(texto) ?? `La nube respondió ${r.status}`);
    return (texto ? JSON.parse(texto) : null) as T;
  }

  private enviar(ruta: string, opciones: { metodo?: string; cuerpo?: unknown }) {
    return fetch(`${this.baseUrl}${ruta}`, {
      method: opciones.metodo ?? "GET",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.accessToken}` },
      body: opciones.cuerpo === undefined ? undefined : JSON.stringify(opciones.cuerpo),
      signal: AbortSignal.timeout(30_000),
    });
  }

  private async renovar(): Promise<void> {
    const r = await fetch(`${this.baseUrl}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: await this.obtenerRefresh() }),
      signal: AbortSignal.timeout(30_000),
    });
    const texto = await r.text();
    if (!r.ok) {
      throw new ErrorNube(r.status, r.status === 401 ? "La sesión con la nube caducó: vincula este POS otra vez con un código nuevo" : (extraerMensaje(texto) ?? "No se pudo renovar la sesión con la nube"));
    }
    const sesion = JSON.parse(texto) as { accessToken: string; refreshToken: string };
    await this.guardarRefresh(sesion.refreshToken);
    this.accessToken = sesion.accessToken;
  }
}

/** URL base de la API a partir de lo que teclee el admin: con o sin `/api/v1` y barra final. */
export function normalizarUrlErp(url: string): string {
  return `${url.trim().replace(/\/+$/, "").replace(/\/api\/v1$/i, "")}/api/v1`;
}

function extraerMensaje(texto: string): string | null {
  try {
    const j = JSON.parse(texto);
    return Array.isArray(j?.message) ? j.message.join(", ") : (j?.message ?? null);
  } catch {
    return texto || null;
  }
}
