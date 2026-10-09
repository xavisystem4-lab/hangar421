import { EventEmitter, requireOptionalNativeModule, type Subscription } from "expo-modules-core";

/**
 * Contraparte JS del módulo nativo HangarNotificaciones (android/…/HangarNotificacionesModule.kt):
 * escucha las notificaciones de la app de DiDi (u otra de reparto) instalada en la misma tablet
 * y las entrega al POS para avisar y registrar el pedido.
 *
 * `requireOptionalNativeModule` devuelve null cuando el módulo no está en el binario (Expo Go,
 * un APK anterior a esta versión): la app sigue igual y la pantalla de Plataformas avisa que
 * hace falta actualizar.
 */
interface NativoNotificaciones {
  permisoConcedido(): boolean;
  servicioConectado(): boolean;
  abrirAjustesAcceso(): boolean;
  activo(): boolean;
  guardarActivo(activo: boolean): boolean;
  listarPendientes(): string;
  marcarProcesadas(idsJson: string): boolean;
  vaciarPendientes(): boolean;
  paquetesVigilados(): string;
  guardarPaquetesVigilados(json: string): boolean;
  listarAppsInstaladas(): string;
}

const nativo = requireOptionalNativeModule<NativoNotificaciones>("HangarNotificaciones");
const emisor = nativo ? new EventEmitter(nativo as any) : null;

/** Una notificación captada tal cual la mostró Android. */
export interface NotificacionCaptada {
  id: string;
  paquete: string;
  app: string;
  titulo: string;
  texto: string;
  /** Epoch ms. */
  hora: number;
}

export interface AppInstalada {
  paquete: string;
  nombre: string;
  vigilada: boolean;
}

function parsear<T>(json: string | undefined | null, porDefecto: T): T {
  try {
    return json ? (JSON.parse(json) as T) : porDefecto;
  } catch {
    return porDefecto;
  }
}

export const notificacionesApp = {
  /** false = este APK no trae el módulo (actualizar). */
  moduloDisponible: nativo != null,
  permisoConcedido: (): boolean => (nativo ? nativo.permisoConcedido() : false),
  servicioConectado: (): boolean => (nativo ? nativo.servicioConectado() : false),
  abrirAjustesAcceso: (): void => { nativo?.abrirAjustesAcceso(); },
  activo: (): boolean => (nativo ? nativo.activo() : false),
  guardarActivo: (activo: boolean): void => { nativo?.guardarActivo(activo); },
  listarPendientes: (): NotificacionCaptada[] => parsear<NotificacionCaptada[]>(nativo?.listarPendientes(), []),
  marcarProcesadas: (ids: string[]): void => { if (ids.length > 0) nativo?.marcarProcesadas(JSON.stringify(ids)); },
  vaciarPendientes: (): void => { nativo?.vaciarPendientes(); },
  paquetesVigilados: (): string[] => parsear<string[]>(nativo?.paquetesVigilados(), []),
  guardarPaquetesVigilados: (paquetes: string[]): void => { nativo?.guardarPaquetesVigilados(JSON.stringify(paquetes)); },
  listarAppsInstaladas: (): AppInstalada[] => parsear<AppInstalada[]>(nativo?.listarAppsInstaladas(), []),
  /** Se dispara al momento por cada notificación nueva de una app vigilada mientras el POS está abierto. */
  alRecibir: (callback: (n: NotificacionCaptada) => void): Subscription | null => {
    if (!emisor) return null;
    return emisor.addListener<{ json: string }>("notificacion", (evento) => {
      const n = parsear<NotificacionCaptada | null>(evento?.json, null);
      if (n) callback(n);
    });
  },
};
