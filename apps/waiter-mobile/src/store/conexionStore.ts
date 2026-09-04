import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { create } from "zustand";

const CLAVE = "hangar421_estacion";
const CLAVE_MENU = "hangar421_menu_meta";
const INTERVALO_HEARTBEAT_MS = 15_000;
const TIMEOUT_MS = 5_000;

export type EstadoConexion = "verificando" | "conectado" | "error";

interface ConexionState {
  host: string;
  puerto: string;
  estado: EstadoConexion;
  ultimoError: string | null;
  ultimaVerificacion: number | null;
  /** Nombre de la empresa que responde en host:puerto (viene de GET /health) — permite
   *  "reconocer" la Estación (mostrar "Conectado a HANGAR 421" en vez de solo una IP pelada),
   *  útil para confirmar que se apuntó al negocio correcto antes de guardar. null mientras no
   *  se ha verificado con éxito, o si el servidor no lo informó (versiones viejas del backend). */
  nombreEstacion: string | null;
  /** Metadata de la última vez que se sincronizó el catálogo (categorías+productos) contra la
   *  Estación — la actualiza `actualizarMenu()` en ../sync/actualizarMenu.ts (aparte, para no
   *  crear un ciclo de imports: ese módulo necesita `apiFetch`, que a su vez importa de este
   *  archivo `obtenerApiUrl`). Persistida aparte de host/puerto: sigue siendo válida aunque se
   *  cambie de Estación (por ejemplo al reconectar a la misma PC tras un reinicio). */
  ultimaActualizacionMenu: number | null;
  productosSincronizados: number | null;
  sincronizandoMenu: boolean;
  cargando: boolean;
  /** Carga la Estación guardada (o el valor por defecto de app.json) y hace la primera verificación. */
  cargar: () => Promise<void>;
  /** Guarda una nueva Estación (IP + puerto) sólo si responde /health; retorna si quedó conectada. */
  probarYGuardar: (host: string, puerto: string) => Promise<boolean>;
  /** Verifica el host/puerto actual sin cambiarlos. */
  verificar: () => Promise<boolean>;
  iniciarHeartbeat: () => void;
  detenerHeartbeat: () => void;
}

let temporizador: ReturnType<typeof setInterval> | null = null;

/** Estación por defecto: "localhost", un valor que a propósito NUNCA responde en un
 *  celular/tablet real — así, en la primera apertura (sin ninguna Estación guardada todavía),
 *  `cargar()` falla la verificación y `App.tsx` manda directo a ConexionScreen. La app de
 *  meseros SIEMPRE debe apuntar al sistema de la PC del local (el backend embebido del POS, en
 *  la misma red Wi-Fi) — no hay fallback silencioso a ningún backend en la nube: si algún local
 *  sí quisiera usar un backend remoto, lo escribe a mano aquí igual (host:puerto es cualquier
 *  servidor HTTP/HTTPS que responda `/api/v1/health`), pero nunca es el comportamiento de
 *  fábrica. */
function estacionPorDefecto(): { host: string; puerto: string } {
  const apiUrl: string = Constants.expoConfig?.extra?.apiUrl ?? "http://localhost:3000/api/v1";
  try {
    const u = new URL(apiUrl);
    return { host: u.hostname, puerto: u.port || (u.protocol === "https:" ? "443" : "80") };
  } catch {
    return { host: "localhost", puerto: "3000" };
  }
}

/** El backend en la nube (Railway) sirve por HTTPS en 443; un servidor propio en la red local
 *  (el backend embebido del POS, o cualquier IP LAN) sirve HTTP plano en su puerto — no hay
 *  certificado que instalar en una tablet de comandero móvil. Se infiere del puerto para que el
 *  mesero no tenga que elegir el protocolo a mano. */
function esquemaPara(puerto: string): "http" | "https" {
  return puerto === "443" ? "https" : "http";
}

export function baseUrl(host: string, puerto: string): string {
  return `${esquemaPara(puerto)}://${host}${puerto === "443" ? "" : `:${puerto}`}`;
}

/** Valida el formato de la IP/host — vacío, con espacios, o con caracteres que no pueden
 *  aparecer en un host (ej. pegaron una URL completa por error) se rechazan ANTES de intentar
 *  la conexión. Si son 4 octetos numéricos, además se valida que cada uno esté en 0-255 (si no,
 *  probablemente se transpuso mal un dígito). Se permite cualquier otro hostname (ej.
 *  "localhost", o el nombre de red del equipo) sin ser tan estricto — no todos los setups usan
 *  una IP literal. */
export function validarHost(host: string): string | null {
  if (!host.trim()) return "Falta la IP del servidor";
  if (/\s/.test(host)) return "La IP no debe tener espacios";
  if (!/^[A-Za-z0-9.-]+$/.test(host)) return "IP con formato inválido";
  const octetos = host.split(".");
  if (octetos.length === 4 && octetos.every((o) => /^\d+$/.test(o))) {
    if (octetos.some((o) => Number(o) > 255)) return "IP con formato inválido (cada número debe ser 0-255)";
  }
  return null;
}

/** Puerto: entero 1-65535. */
export function validarPuerto(puerto: string): string | null {
  if (!puerto.trim()) return "Falta el puerto";
  if (!/^\d+$/.test(puerto.trim())) return "El puerto debe ser un número";
  const n = Number(puerto);
  if (n < 1 || n > 65535) return "El puerto debe estar entre 1 y 65535";
  return null;
}

/** Clasifica el error de un intento de conexión fallido en una pista legible — no se puede
 *  distinguir con certeza absoluta "IP incorrecta" de "servidor apagado" de "firewall" con solo
 *  un fetch, pero se puede acotar bastante por el TIPO de fallo: un timeout (nadie respondió en
 *  absoluto) sugiere IP/red/firewall; un rechazo inmediato de conexión sugiere que SÍ hay algo
 *  en esa IP pero no en ese puerto (o el software no está corriendo); una respuesta HTTP de
 *  error sugiere que el puerto pertenece a OTRO servicio, no al backend de HANGAR 421. */
function clasificarError(e: any): string {
  if (e?.name === "AbortError") {
    return "Tiempo de espera agotado. Puede ser que: el equipo esté apagado, la IP sea incorrecta, no estén en la misma red Wi-Fi, o un firewall esté bloqueando el puerto.";
  }
  if (e?.message?.startsWith("La Estación respondió con error")) {
    return `${e.message} — el puerto puede pertenecer a otro programa, no al software HANGAR 421.`;
  }
  return "No se pudo conectar. Revisa que: la IP y el puerto sean correctos, el software de PC esté corriendo (servicio no disponible), y el equipo esté en la misma red.";
}

export const useConexionStore = create<ConexionState>((set, get) => ({
  host: "",
  puerto: "",
  estado: "verificando",
  ultimoError: null,
  ultimaVerificacion: null,
  nombreEstacion: null,
  ultimaActualizacionMenu: null,
  productosSincronizados: null,
  sincronizandoMenu: false,
  cargando: true,

  cargar: async () => {
    const raw = await AsyncStorage.getItem(CLAVE);
    const { host, puerto } = raw ? JSON.parse(raw) : estacionPorDefecto();
    const rawMenu = await AsyncStorage.getItem(CLAVE_MENU);
    const menu = rawMenu ? JSON.parse(rawMenu) : null;
    set({
      host,
      puerto,
      cargando: false,
      ultimaActualizacionMenu: menu?.ultimaActualizacionMenu ?? null,
      productosSincronizados: menu?.productosSincronizados ?? null,
    });
    await get().verificar();
  },

  probarYGuardar: async (host, puerto) => {
    const errorHost = validarHost(host);
    const errorPuerto = validarPuerto(puerto);
    if (errorHost || errorPuerto) {
      set({ estado: "error", ultimoError: errorHost ?? errorPuerto });
      return false;
    }
    set({ host, puerto, estado: "verificando", ultimoError: null });
    const ok = await get().verificar();
    if (ok) await AsyncStorage.setItem(CLAVE, JSON.stringify({ host, puerto }));
    return ok;
  },

  verificar: async () => {
    const { host, puerto } = get();
    const errorHost = validarHost(host);
    const errorPuerto = validarPuerto(puerto);
    if (errorHost || errorPuerto) {
      set({ estado: "error", ultimoError: errorHost ?? errorPuerto });
      return false;
    }
    set({ estado: "verificando" });
    try {
      const controlador = new AbortController();
      const limite = setTimeout(() => controlador.abort(), TIMEOUT_MS);
      const res = await fetch(`${baseUrl(host, puerto)}/api/v1/health`, { signal: controlador.signal });
      clearTimeout(limite);
      if (!res.ok) throw new Error(`La Estación respondió con error ${res.status}`);
      const body = await res.json().catch(() => ({}));
      set({ estado: "conectado", ultimoError: null, ultimaVerificacion: Date.now(), nombreEstacion: body?.empresa ?? null });
      return true;
    } catch (e: any) {
      set({ estado: "error", ultimoError: clasificarError(e), ultimaVerificacion: Date.now(), nombreEstacion: null });
      return false;
    }
  },

  /** Reintenta la conexión con la Estación cada 15s — así la app detecta sola cuando el
   *  servidor vuelve a estar disponible (o cuando se cae) sin que el mesero tenga que hacer nada. */
  iniciarHeartbeat: () => {
    if (temporizador) return;
    temporizador = setInterval(() => {
      get().verificar();
    }, INTERVALO_HEARTBEAT_MS);
  },

  detenerHeartbeat: () => {
    if (temporizador) clearInterval(temporizador);
    temporizador = null;
  },
}));

export function obtenerApiUrl(): string {
  const { host, puerto } = useConexionStore.getState();
  return `${baseUrl(host, puerto)}/api/v1`;
}

export function obtenerWsUrl(): string {
  const { host, puerto } = useConexionStore.getState();
  return baseUrl(host, puerto);
}

/** Guarda en el store + AsyncStorage el resultado de una sincronización de menú — lo llama
 *  ../sync/actualizarMenu.ts al terminar. Vive aquí (no allá) para que sea el único lugar que
 *  toca `CLAVE_MENU`. */
export async function guardarMetaMenu(productos: number): Promise<void> {
  const ahora = Date.now();
  await AsyncStorage.setItem(CLAVE_MENU, JSON.stringify({ ultimaActualizacionMenu: ahora, productosSincronizados: productos }));
  useConexionStore.setState({ ultimaActualizacionMenu: ahora, productosSincronizados: productos });
}
