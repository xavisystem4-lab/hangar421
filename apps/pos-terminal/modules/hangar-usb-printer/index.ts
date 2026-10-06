import { requireOptionalNativeModule } from "expo-modules-core";

/**
 * Contraparte JS del módulo nativo HangarUsbPrinter (android/…/HangarUsbPrinterModule.kt):
 * impresora térmica ESC/POS por USB OTG. Los datos cruzan como JSON en texto.
 *
 * `requireOptionalNativeModule` devuelve null en vez de lanzar cuando el módulo no está
 * compilado en el binario (Expo Go, iOS, un APK viejo): la app sigue funcionando y la
 * impresión cae al recibo en pantalla.
 */
interface NativoImpresoraUsb {
  isAvailable(): Promise<boolean>;
  listarDispositivos(): Promise<string>;
  solicitarPermiso(vendorId: number, productId: number): Promise<boolean>;
  obtenerConfig(): Promise<string>;
  guardarConfig(json: string): Promise<void>;
  imprimirTicket(json: string, anchoMM: number): Promise<boolean>;
  imprimirPrueba(anchoMM: number): Promise<boolean>;
  sonarAviso?(): boolean;
  abrirInstalador?(contentUri: string): "ok" | "permiso";
}

const nativo = requireOptionalNativeModule<NativoImpresoraUsb>("HangarUsbPrinter");

export interface DispositivoUsb {
  nombreSistema: string;
  vendorId: number;
  productId: number;
  fabricante: string | null;
  producto: string | null;
  clasesInterfaz: number[];
  esClaseImpresora: boolean;
  tieneSalidaBulk: boolean;
  tienePermiso: boolean;
  seleccionada: boolean;
}

export interface ConfigImpresoraUsb {
  /** Número de `ESC t n`: 16 = WPC1252, 2 = PC850, 0 = PC437. */
  codePage: number;
  quitarAcentos: boolean;
  cortarPapel: boolean;
  abrirCajon: boolean;
  imprimirLogo: boolean;
  vendorId: number | null;
  productId: number | null;
}

/**
 * Expo envuelve los errores nativos como "Call to function 'HangarUsbPrinter.x' has been
 * rejected. → Caused by: <motivo>". El cajero solo necesita el motivo.
 */
export function mensajeImpresora(e: unknown): string {
  const texto = String((e as any)?.message ?? e ?? "");
  return texto.replace(/^Call to function '[^']*' has been rejected\.?\s*(→\s*)?(Caused by:\s*)?/s, "").trim() || "Error de la impresora";
}

/** Ejecuta una llamada nativa y deja el error con el motivo limpio. */
async function llamar<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw new Error(mensajeImpresora(e));
  }
}

function exigir(): NativoImpresoraUsb {
  if (!nativo) throw new Error("Esta versión de la app no incluye el módulo de impresora USB.");
  return nativo;
}

export const impresoraUsb = {
  /** false si el binario no trae el módulo nativo (no confundir con "no hay impresora conectada"). */
  moduloDisponible: nativo != null,

  async hayImpresora(): Promise<boolean> {
    return nativo ? nativo.isAvailable().catch(() => false) : false;
  },
  async listarDispositivos(): Promise<DispositivoUsb[]> {
    return JSON.parse(await llamar(() => exigir().listarDispositivos()));
  },
  async solicitarPermiso(vendorId: number, productId: number): Promise<boolean> {
    return llamar(() => exigir().solicitarPermiso(vendorId, productId));
  },
  async obtenerConfig(): Promise<ConfigImpresoraUsb> {
    return JSON.parse(await llamar(() => exigir().obtenerConfig()));
  },
  async guardarConfig(config: ConfigImpresoraUsb): Promise<void> {
    await llamar(() => exigir().guardarConfig(JSON.stringify(config)));
  },
  async imprimirTicket(ticket: object, anchoMM: 58 | 80): Promise<void> {
    await llamar(() => exigir().imprimirTicket(JSON.stringify(ticket), anchoMM));
  },
  async imprimirPrueba(anchoMM: 58 | 80): Promise<void> {
    await llamar(() => exigir().imprimirPrueba(anchoMM));
  },
};

/** Tono de notificación del sistema (aviso de pedido de delivery). No hace nada en un APK viejo
 *  que no trae la función nativa, ni fuera de Android. */
export function sonarAviso(): boolean {
  try {
    return nativo?.sonarAviso?.() ?? false;
  } catch {
    return false;
  }
}

/** Abre el instalador de Android con un .apk descargado (content://). "permiso" = se abrió el
 *  ajuste para permitir instalar apps desde el POS; null = APK viejo sin la función nativa. */
export function abrirInstalador(contentUri: string): "ok" | "permiso" | null {
  if (!nativo?.abrirInstalador) return null;
  return nativo.abrirInstalador(contentUri);
}
