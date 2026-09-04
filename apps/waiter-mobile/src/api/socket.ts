import { io, Socket } from "socket.io-client";
import { obtenerWsUrl } from "../store/conexionStore";

let socket: Socket | null = null;

export function conectarSocket(sucursalId: string, usuarioId: string): Socket {
  if (socket) socket.disconnect();
  socket = io(obtenerWsUrl(), { path: "/realtime", transports: ["websocket"] });
  socket.on("connect", () => socket?.emit("join", { sucursalId, usuarioId }));
  return socket;
}

export function desconectarSocket() {
  socket?.disconnect();
  socket = null;
}
