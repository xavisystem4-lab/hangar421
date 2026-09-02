import Constants from "expo-constants";
import { io, Socket } from "socket.io-client";

const WS_URL: string = Constants.expoConfig?.extra?.wsUrl ?? "http://localhost:3000";
let socket: Socket | null = null;

export function conectarSocket(sucursalId: string, usuarioId: string): Socket {
  if (socket) socket.disconnect();
  socket = io(WS_URL, { path: "/realtime", transports: ["websocket"] });
  socket.on("connect", () => socket?.emit("join", { sucursalId, usuarioId }));
  return socket;
}

export function desconectarSocket() {
  socket?.disconnect();
  socket = null;
}
