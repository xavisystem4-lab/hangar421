import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import { procesarCola } from "./syncEngine";

/**
 * Sincroniza en cuanto vuelve la red, en vez de esperar al siguiente ciclo.
 *
 * Con solo el temporizador de 45s, una tienda que recuperaba el wifi podía tardar casi un minuto
 * en empezar a subir — y si el corte había sido largo, el cajero veía "Sin conexión" con el wifi
 * ya funcionando. Aquí la transición sin-red → con-red dispara el drenado de inmediato.
 *
 * `isInternetReachable` y no solo `isConnected`: estar asociado a un wifi no significa tener
 * salida a internet. El caso típico es el portal cautivo de un centro comercial, donde
 * `isConnected` es true y cualquier petición al ERP falla.
 */
let desuscribir: (() => void) | null = null;
let habiaRed: boolean | null = null;

/** `null` en `isInternetReachable` significa "todavía comprobando" — no se trata como pérdida
 *  de red para no disparar falsas transiciones al arrancar. */
function hayInternet(estado: NetInfoState): boolean {
  return !!estado.isConnected && estado.isInternetReachable !== false;
}

export function iniciarEscuchaDeRed(): void {
  if (desuscribir) return;
  desuscribir = NetInfo.addEventListener((estado) => {
    const ahora = hayInternet(estado);
    const recuperada = habiaRed === false && ahora;
    habiaRed = ahora;
    // Solo en la TRANSICIÓN a con-red: reaccionar a cada evento dispararía varias sincronizaciones
    // seguidas cuando el wifi parpadea, que es justo cuando menos conviene insistir.
    if (recuperada) procesarCola(true).catch(() => undefined);
  });
}

export function detenerEscuchaDeRed(): void {
  desuscribir?.();
  desuscribir = null;
  habiaRed = null;
}

/** ¿Hay internet ahora mismo? Se usa antes de intentar una operación que exige red, para poder
 *  explicar el motivo en vez de dejar que falle con un timeout de 10 segundos. */
export async function hayInternetAhora(): Promise<boolean> {
  try {
    return hayInternet(await NetInfo.fetch());
  } catch {
    // Si NetInfo falla, se asume que sí hay red: es mejor intentarlo y fallar que bloquear una
    // operación por no poder comprobar el estado.
    return true;
  }
}
