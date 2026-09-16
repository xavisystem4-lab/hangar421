import { io, Socket } from "socket.io-client";

const WS_URL_POR_DEFECTO = import.meta.env.VITE_WS_URL ?? "http://localhost:3000";

/** Se fija al iniciar la app junto con la API URL (ver App.tsx). El backend HTTP y el
 *  WebSocket embebidos comparten el mismo host:puerto, así que se deriva de la misma URL. */
let wsUrlResuelta: string | null = null;

export function configurarWsUrl(url: string) {
  wsUrlResuelta = url;
}

let socket: Socket | null = null;

export function conectarSocket(sucursalId: string): Socket {
  if (socket) socket.disconnect();
  socket = io(wsUrlResuelta ?? WS_URL_POR_DEFECTO, { path: "/realtime", transports: ["websocket"] });
  // tipo:"pos" — la app de Meseros usa esto (ver RealtimeGateway.posActivo / GET
  // /realtime/pos-activo) para saber si el POS de esta sucursal tiene sesión iniciada AHORA
  // MISMO, sin confundirlo con "el backend en la nube responde" (Railway sigue en línea 24/7
  // aunque nadie esté usando el POS).
  socket.on("connect", () => socket?.emit("join", { sucursalId, tipo: "pos" }));
  return socket;
}

export function obtenerSocket(): Socket | null {
  return socket;
}

export function desconectarSocket() {
  socket?.disconnect();
  socket = null;
}
