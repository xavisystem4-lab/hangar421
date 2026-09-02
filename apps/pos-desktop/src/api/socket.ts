import { io, Socket } from "socket.io-client";

const WS_URL = import.meta.env.VITE_WS_URL ?? "http://localhost:3000";
let socket: Socket | null = null;

export function conectarSocket(sucursalId: string): Socket {
  if (socket) socket.disconnect();
  socket = io(WS_URL, { path: "/realtime", transports: ["websocket"] });
  socket.on("connect", () => socket?.emit("join", { sucursalId }));
  return socket;
}

export function obtenerSocket(): Socket | null {
  return socket;
}

export function desconectarSocket() {
  socket?.disconnect();
  socket = null;
}
