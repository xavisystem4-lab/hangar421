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
    return JSON.parse(await exigir().listarDispositivos());
  },
  async solicitarPermiso(vendorId: number, productId: number): Promise<boolean> {
    return exigir().solicitarPermiso(vendorId, productId);
  },
  async obtenerConfig(): Promise<ConfigImpresoraUsb> {
    return JSON.parse(await exigir().obtenerConfig());
  },
  async guardarConfig(config: ConfigImpresoraUsb): Promise<void> {
    await exigir().guardarConfig(JSON.stringify(config));
  },
  async imprimirTicket(ticket: object, anchoMM: 58 | 80): Promise<void> {
    await exigir().imprimirTicket(JSON.stringify(ticket), anchoMM);
  },
  async imprimirPrueba(anchoMM: 58 | 80): Promise<void> {
    await exigir().imprimirPrueba(anchoMM);
  },
};
