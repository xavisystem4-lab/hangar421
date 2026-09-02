import { io, Socket } from "socket.io-client";

const WS_URL = import.meta.env.VITE_WS_URL ?? "http://localhost:3000";

let socket: Socket | null = null;

/** Conecta al gateway de tiempo real y une la sala de la sucursal (y estación, si aplica). */
export function conectarSocket(sucursalId: string, estacionId?: string): Socket {
  if (socket) socket.disconnect();
  socket = io(WS_URL, { path: "/realtime", transports: ["websocket"] });
  socket.on("connect", () => {
    socket?.emit("join", { sucursalId, estacionId });
  });
  return socket;
}

export function obtenerSocket(): Socket | null {
  return socket;
}
