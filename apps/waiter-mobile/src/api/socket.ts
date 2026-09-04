import { io, Socket } from "socket.io-client";
import { obtenerWsUrl } from "../store/conexionStore";

let socket: Socket | null = null;

/** Conecta el WebSocket de toda la sesión — se llama una vez al iniciar sesión (ver App.tsx),
 *  no por pantalla, para que la conexión (y lo que expone en el panel "Conexión Meseros" del
 *  POS, ver realtime.gateway.ts) refleje si el mesero de verdad sigue activo, sin importar en
 *  qué pestaña esté parado dentro de la app. Antes se conectaba/desconectaba con el montaje de
 *  MisPedidosScreen — un mesero parado en "Mesas" o "Pedido" aparecía como desconectado aunque
 *  la app siguiera abierta y funcionando. */
export function conectarSocket(sucursalId: string, usuarioId: string, usuarioNombre: string, dispositivoId: string): Socket {
  if (socket) socket.disconnect();
  socket = io(obtenerWsUrl(), { path: "/realtime", transports: ["websocket"] });
  socket.on("connect", () =>
    socket?.emit("join", {
      sucursalId,
      usuarioId,
      usuarioNombre,
      dispositivoId,
      nombreDispositivo: usuarioNombre, // no hay nombre de equipo real en un celular/tablet — se usa el del mesero, es lo que identifica al admin de todos modos
      tipo: "mesero",
    }),
  );
  return socket;
}

/** El socket ya conectado (o null si nadie ha llamado `conectarSocket` todavía) — lo usan las
 *  pantallas que solo necesitan ESCUCHAR eventos mientras están montadas (ej. MisPedidosScreen),
 *  sin ser dueñas del ciclo de vida de la conexión. */
export function obtenerSocket(): Socket | null {
  return socket;
}

export function desconectarSocket() {
  socket?.disconnect();
  socket = null;
}
