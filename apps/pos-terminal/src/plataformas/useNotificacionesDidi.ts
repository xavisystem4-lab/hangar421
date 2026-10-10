import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Vibration } from "react-native";
import { abrirBaseDeDatos } from "../db/database";
import { obtenerConfig } from "../db/configLocalRepo";
import { MELODIA_DIDI_RECORDATORIO, sonarAvisoDidi, sonarMelodia } from "../../modules/hangar-usb-printer";
import { notificacionesApp, type NotificacionCaptada } from "../../modules/hangar-notificaciones";
import { CLAVE_SONIDO_DELIVERY } from "./useAvisosDelivery";
import { ameritaAviso, interpretarNotificacion, type NotificacionInterpretada } from "./notificacionesDidi";

/** "1" (por defecto) = cada 30 s vuelve a sonar un recordatorio corto mientras haya pedidos de
 *  DiDi detectados sin registrar; "0" = solo suena al llegar. Se cambia en Admin → Delivery. */
export const CLAVE_DIDI_REPETIR_AVISO = "didi_repetir_aviso";
const INTERVALO_RECORDATORIO_MS = 30_000;
/** Tope de recordatorios por pedido (15 min); después deja de insistir pero el banner sigue. */
const MAX_RECORDATORIOS = 30;

export interface PedidoDetectado extends NotificacionInterpretada {
  id: string;
  app: string;
  titulo: string;
  texto: string;
  hora: number;
}

export interface EstadoNotificacionesDidi {
  /** false = este APK no trae el módulo nativo. */
  disponible: boolean;
  /** El usuario ya concedió "Acceso a notificaciones" a la app. */
  permiso: boolean;
  /** Pedidos detectados y aún no atendidos (los más recientes primero). */
  detectados: PedidoDetectado[];
  /** Pedidos nuevos reconocidos como tales y todavía sin registrar (para el banner y el recordatorio). */
  pendientes: PedidoDetectado[];
  /** El último que amerita aviso y no se ha descartado, para el banner. */
  aviso: PedidoDetectado | null;
  descartarAviso: () => void;
  /** Lo quita de la bandeja (ya se registró o no era un pedido). */
  atender: (id: string) => void;
  recargar: () => void;
}

function interpretar(n: NotificacionCaptada): PedidoDetectado {
  return { ...interpretarNotificacion(n), id: n.id, app: n.app, titulo: n.titulo, texto: n.texto, hora: n.hora };
}

async function sonidoActivo(): Promise<boolean> {
  try {
    const db = await abrirBaseDeDatos();
    return (await obtenerConfig(db, CLAVE_SONIDO_DELIVERY)) !== "0";
  } catch {
    return true;
  }
}

async function recordatorioActivo(): Promise<boolean> {
  try {
    const db = await abrirBaseDeDatos();
    return (await obtenerConfig(db, CLAVE_DIDI_REPETIR_AVISO)) !== "0";
  } catch {
    return true;
  }
}

/**
 * Pedidos que la app de DiDi (en la misma tablet) anuncia por notificación. El servicio nativo
 * los guarda aunque el POS esté cerrado; aquí se leen al abrir y al volver a primer plano, y
 * los que llegan con el POS abierto entran al momento por evento.
 *
 * Al llegar uno nuevo suena el **pitido distintivo de DiDi** (ti-ti-tiii ×2, distinto al tono
 * del sistema) y vibra; mientras siga sin registrarse, cada 30 s suena un recordatorio corto
 * (configurable) — así nadie se entera tarde de que hay un pedido por preparar y cobrar.
 */
export function useNotificacionesDidi(activo: boolean): EstadoNotificacionesDidi {
  const [detectados, setDetectados] = useState<PedidoDetectado[]>([]);
  const [aviso, setAviso] = useState<PedidoDetectado | null>(null);
  const [permiso, setPermiso] = useState(false);
  const vistos = useRef(new Set<string>());
  const recordatorios = useRef(new Map<string, number>());

  const avisar = useCallback(async (nuevos: PedidoDetectado[]) => {
    const conAviso = nuevos.filter(ameritaAviso);
    if (conAviso.length === 0) return;
    setAviso(conAviso[0]);
    Vibration.vibrate([0, 300, 150, 300, 150, 500]);
    if (await sonidoActivo()) sonarAvisoDidi();
  }, []);

  const recargar = useCallback(() => {
    if (!activo || !notificacionesApp.moduloDisponible) return;
    const tienePermiso = notificacionesApp.permisoConcedido();
    setPermiso(tienePermiso);
    if (!tienePermiso || !notificacionesApp.activo()) { setDetectados([]); return; }
    const lista = notificacionesApp.listarPendientes().map(interpretar);
    // Lo que es ruido seguro (entregado, promoción…) se descarta solo: no estorba en la bandeja.
    const ruido = lista.filter((n) => n.esRuido).map((n) => n.id);
    notificacionesApp.marcarProcesadas(ruido);
    const utiles = lista.filter((n) => !n.esRuido);
    setDetectados(utiles);
    const nuevos = utiles.filter((n) => !vistos.current.has(n.id));
    for (const n of utiles) vistos.current.add(n.id);
    // También en la primera carga: lo que llegó con el POS cerrado merece el mismo aviso.
    if (nuevos.length > 0) avisar(nuevos);
  }, [activo, avisar]);

  useEffect(() => {
    if (!activo || !notificacionesApp.moduloDisponible) return;
    recargar();
    const sub = notificacionesApp.alRecibir(() => recargar());
    const appState = AppState.addEventListener("change", (estado) => { if (estado === "active") recargar(); });
    // Respaldo por si el evento no llega (JS dormido): cada 30 s se relee la bandeja nativa.
    const intervalo = setInterval(recargar, 30_000);
    return () => { sub?.remove(); appState.remove(); clearInterval(intervalo); };
  }, [activo, recargar]);

  const pendientes = detectados.filter((n) => n.esPedidoNuevo);

  // Recordatorio: mientras haya pedidos nuevos sin registrar, un toque corto cada 30 s (con tope),
  // aunque el cajero haya cerrado el banner. Se detiene solo al registrar o descartar el pedido.
  const idsPendientes = pendientes.map((p) => p.id).join("|");
  useEffect(() => {
    if (!activo || !idsPendientes) return;
    const timer = setInterval(async () => {
      const ids = idsPendientes.split("|").filter((id) => (recordatorios.current.get(id) ?? 0) < MAX_RECORDATORIOS);
      if (ids.length === 0) return;
      for (const id of ids) recordatorios.current.set(id, (recordatorios.current.get(id) ?? 0) + 1);
      if (!(await recordatorioActivo()) || !(await sonidoActivo())) return;
      Vibration.vibrate(200);
      sonarMelodia(MELODIA_DIDI_RECORDATORIO);
    }, INTERVALO_RECORDATORIO_MS);
    return () => clearInterval(timer);
  }, [activo, idsPendientes]);

  const atender = useCallback((id: string) => {
    notificacionesApp.marcarProcesadas([id]);
    recordatorios.current.delete(id);
    setDetectados((d) => d.filter((n) => n.id !== id));
    setAviso((a) => (a?.id === id ? null : a));
  }, []);

  return {
    disponible: notificacionesApp.moduloDisponible,
    permiso,
    detectados,
    pendientes,
    aviso,
    descartarAviso: () => setAviso(null),
    atender,
    recargar,
  };
}
