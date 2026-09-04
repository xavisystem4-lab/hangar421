import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { create } from "zustand";

const CLAVE = "hangar421_estacion";
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

function baseUrl(host: string, puerto: string): string {
  return `${esquemaPara(puerto)}://${host}${puerto === "443" ? "" : `:${puerto}`}`;
}

export const useConexionStore = create<ConexionState>((set, get) => ({
  host: "",
  puerto: "",
  estado: "verificando",
  ultimoError: null,
  ultimaVerificacion: null,
  nombreEstacion: null,
  cargando: true,

  cargar: async () => {
    const raw = await AsyncStorage.getItem(CLAVE);
    const { host, puerto } = raw ? JSON.parse(raw) : estacionPorDefecto();
    set({ host, puerto, cargando: false });
    await get().verificar();
  },

  probarYGuardar: async (host, puerto) => {
    set({ host, puerto, estado: "verificando", ultimoError: null });
    const ok = await get().verificar();
    if (ok) await AsyncStorage.setItem(CLAVE, JSON.stringify({ host, puerto }));
    return ok;
  },

  verificar: async () => {
    const { host, puerto } = get();
    if (!host || !puerto) {
      set({ estado: "error", ultimoError: "Falta la IP o el puerto de la Estación" });
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
      const mensaje = e?.name === "AbortError" ? "Tiempo de espera agotado" : e?.message ?? "No se pudo conectar con la Estación";
      set({ estado: "error", ultimoError: mensaje, ultimaVerificacion: Date.now(), nombreEstacion: null });
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
