import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Vibration } from "react-native";
import { abrirBaseDeDatos } from "../db/database";
import { obtenerConfig } from "../db/configLocalRepo";
import { sonarAviso } from "../../modules/hangar-usb-printer";
import { notificacionesApp, type NotificacionCaptada } from "../../modules/hangar-notificaciones";
import { CLAVE_SONIDO_DELIVERY } from "./useAvisosDelivery";
import { ameritaAviso, interpretarNotificacion, type NotificacionInterpretada } from "./notificacionesDidi";

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

/**
 * Pedidos que la app de DiDi (en la misma tablet) anuncia por notificación. El servicio nativo
 * los guarda aunque el POS esté cerrado; aquí se leen al abrir y al volver a primer plano, y
 * los que llegan con el POS abierto entran al momento por evento. Cada uno nuevo que amerita
 * aviso suena (configurable, mismo ajuste que los avisos de delivery) y vibra.
 */
export function useNotificacionesDidi(activo: boolean): EstadoNotificacionesDidi {
  const [detectados, setDetectados] = useState<PedidoDetectado[]>([]);
  const [aviso, setAviso] = useState<PedidoDetectado | null>(null);
  const [permiso, setPermiso] = useState(false);
  const vistos = useRef(new Set<string>());

  const avisar = useCallback(async (nuevos: PedidoDetectado[]) => {
    const conAviso = nuevos.filter(ameritaAviso);
    if (conAviso.length === 0) return;
    setAviso(conAviso[0]);
    Vibration.vibrate([0, 300, 150, 300]);
    try {
      const db = await abrirBaseDeDatos();
      if ((await obtenerConfig(db, CLAVE_SONIDO_DELIVERY)) !== "0") sonarAviso();
    } catch {
      /* sin sonido */
    }
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

  const atender = useCallback((id: string) => {
    notificacionesApp.marcarProcesadas([id]);
    setDetectados((d) => d.filter((n) => n.id !== id));
    setAviso((a) => (a?.id === id ? null : a));
  }, []);

  return {
    disponible: notificacionesApp.moduloDisponible,
    permiso,
    detectados,
    aviso,
    descartarAviso: () => setAviso(null),
    atender,
    recargar,
  };
}
