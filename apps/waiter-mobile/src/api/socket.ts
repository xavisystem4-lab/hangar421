import Constants from "expo-constants";
import { Platform } from "react-native";
import { io, Socket } from "socket.io-client";
import { obtenerWsUrl } from "../store/conexionStore";

let socket: Socket | null = null;
let temporizadorHeartbeat: ReturnType<typeof setInterval> | null = null;

/** Cada cuánto la app manda una prueba de vida a nivel de aplicación mientras el socket esté
 *  conectado (independiente del ping/pong de transporte de Socket.IO, que ya detecta solo una
 *  conexión caída) — el backend usa esto para el campo "Último heartbeat" que se muestra en el
 *  panel de Administración → "Dispositivos Meseros Conectados" (ver realtime.gateway.ts). */
const HEARTBEAT_APP_MS = 10_000;

/** Conecta el WebSocket de toda la sesión — se llama una vez al iniciar sesión (ver App.tsx),
 *  no por pantalla, para que la conexión (y lo que expone en el panel "Conexión Meseros" del
 *  POS, ver realtime.gateway.ts) refleje si el mesero de verdad sigue activo, sin importar en
 *  qué pestaña esté parado dentro de la app. Antes se conectaba/desconectaba con el montaje de
 *  MisPedidosScreen — un mesero parado en "Mesas" o "Pedido" aparecía como desconectado aunque
 *  la app siguiera abierta y funcionando.
 *
 *  Esta conexión ES la sesión real entre la APK y el software de PC: Socket.IO ya trae
 *  reconexión automática con backoff y un heartbeat de transporte (ping/pong, ver
 *  pingInterval/pingTimeout en realtime.gateway.ts) que detecta solo cualquier caída de
 *  conexión (proceso terminado, apagón, red caída, Wi-Fi perdido) sin código adicional — el
 *  evento nativo "disconnect" de abajo es la señal de verdad, no un poll aparte. */
export function conectarSocket(
  sucursalId: string,
  usuarioId: string,
  usuarioNombre: string,
  dispositivoId: string,
  tipoDispositivo?: "tablet" | "celular",
): Socket {
  if (socket) socket.disconnect();
  socket = io(obtenerWsUrl(), { path: "/realtime", transports: ["websocket"] });
  socket.on("connect", () => {
    socket?.emit("join", {
      sucursalId,
      usuarioId,
      usuarioNombre,
      dispositivoId,
      nombreDispositivo: usuarioNombre, // no hay nombre de equipo real en un celular/tablet — se usa el del mesero, es lo que identifica al admin de todos modos
      tipo: "mesero",
      tipoDispositivo, // ver useDispositivo().esTablet — puramente informativo para el panel de Administración
      appVersion: Constants.expoConfig?.version,
      so: Platform.OS,
    });
    iniciarHeartbeatApp();
  });
  socket.on("disconnect", detenerHeartbeatApp);
  return socket;
}

function iniciarHeartbeatApp() {
  detenerHeartbeatApp();
  temporizadorHeartbeat = setInterval(() => {
    socket?.emit("mesero:heartbeat");
  }, HEARTBEAT_APP_MS);
}

function detenerHeartbeatApp() {
  if (temporizadorHeartbeat) clearInterval(temporizadorHeartbeat);
  temporizadorHeartbeat = null;
}

/** El socket ya conectado (o null si nadie ha llamado `conectarSocket` todavía) — lo usan las
 *  pantallas que solo necesitan ESCUCHAR eventos mientras están montadas (ej. MisPedidosScreen),
 *  sin ser dueñas del ciclo de vida de la conexión. */
export function obtenerSocket(): Socket | null {
  return socket;
}

export function desconectarSocket() {
  detenerHeartbeatApp();
  socket?.disconnect();
  socket = null;
}
