"use client";

import { io, type Socket } from "socket.io-client";
import { origenDeApi } from "@hangar421/shared";

/**
 * Conexión de tiempo real del ERP. Una sola para toda la aplicación.
 *
 * Tres problemas que resuelve, y que son la razón por la que una venta no aparecía sola en la
 * web aunque el backend sí emitiera el evento:
 *
 * 1. **La URL se deducía de una variable propia.** Cada página hacía
 *    `process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:3000"`. En Next.js las variables
 *    `NEXT_PUBLIC_*` se incrustan **al compilar**: si el despliegue define `NEXT_PUBLIC_API_URL`
 *    pero no `NEXT_PUBLIC_WS_URL` —que es lo normal, son dos variables para el mismo servidor—
 *    el navegador intentaba abrir un socket contra `localhost:3000`, que en la máquina del
 *    usuario no existe. El REST seguía funcionando, así que la página cargaba bien y solo el
 *    tiempo real quedaba muerto, en silencio. Ahora la URL se deriva de `NEXT_PUBLIC_API_URL`
 *    quitándole el sufijo `/api/v1`: si el ERP puede hablar por REST, puede hablar por socket.
 *
 * 2. **Cada página abría su propio socket** y lo cerraba al cambiar cualquier filtro, porque el
 *    efecto dependía de la función de recarga. Escribir en el buscador de Ventas desconectaba y
 *    reconectaba el socket en cada tecla.
 *
 * 3. **Una ráfaga de eventos disparaba una ráfaga de peticiones.** Una venta emite
 *    `pedido:creado` y enseguida `pedido:actualizado` al cobrarse; sin agrupar, eso son dos
 *    recargas completas por venta.
 */

const RECARGA_AGRUPADA_MS = 400;

let socket: Socket | null = null;
let empresaUnida: string | null = null;

/** Origen del backend a partir de la URL del API. Acepta que venga con o sin `/api/v1`, y con o
 *  sin barra final: es un valor que se configura a mano en el despliegue. */
export function origenBackend(): string {
  return origenDeApi(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000/api/v1");
}

/**
 * Socket compartido, ya unido a la sala de la empresa.
 *
 * No se desconecta al desmontar una página: la conexión vive mientras dure la sesión del ERP.
 * Abrir y cerrar sockets por pantalla es justo lo que hacía que el tiempo real fuera errático.
 */
export function obtenerSocket(empresaId: string): Socket {
  if (!socket) {
    socket = io(origenBackend(), {
      path: "/realtime",
      // `polling` además de `websocket`: algunos proxys y redes corporativas bloquean la
      // actualización a WebSocket, y sin respaldo el tiempo real se cae del todo en vez de
      // funcionar algo más lento.
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
    });

    // Al reconectar hay que volver a entrar a la sala: las salas viven en el servidor y no
    // sobreviven a la reconexión. Sin esto, tras un corte de red la web quedaba conectada pero
    // sin recibir nada, que es peor que estar desconectada porque no se nota.
    socket.on("connect", () => {
      if (empresaUnida) socket?.emit("join", { empresaId: empresaUnida, tipo: "erp" });
    });
  }

  if (empresaUnida !== empresaId) {
    empresaUnida = empresaId;
    if (socket.connected) socket.emit("join", { empresaId, tipo: "erp" });
  }

  return socket;
}

export function cerrarSocket(): void {
  socket?.disconnect();
  socket = null;
  empresaUnida = null;
}

export interface EventoPedido {
  id?: string;
  sucursalId?: string;
  estado?: string;
}

/**
 * Suscribe una recarga a los eventos de venta.
 *
 * - Agrupa las ráfagas en una sola recarga (`RECARGA_AGRUPADA_MS`).
 * - Con una sucursal activa, ignora los eventos de las demás: el backend emite a toda la
 *   empresa, y sin este filtro una venta de Mecánicos recargaría la pantalla de Benito Juárez
 *   para volver a pintar exactamente lo mismo. Con `sucursalId` nulo (vista consolidada) pasan
 *   todos.
 * - Un evento sin `sucursalId` reconocible se deja pasar: es preferible una recarga de más que
 *   perderse una venta.
 *
 * Devuelve la función para desuscribirse. El socket NO se cierra: es compartido.
 */
export function suscribirVentas(
  empresaId: string,
  sucursalId: string | null,
  recargar: () => void,
): () => void {
  const s = obtenerSocket(empresaId);
  let temporizador: ReturnType<typeof setTimeout> | null = null;

  function manejar(evento: EventoPedido | undefined) {
    const deOtraSucursal = !!sucursalId && !!evento?.sucursalId && evento.sucursalId !== sucursalId;
    if (deOtraSucursal) return;

    if (temporizador) clearTimeout(temporizador);
    temporizador = setTimeout(recargar, RECARGA_AGRUPADA_MS);
  }

  s.on("pedido:creado", manejar);
  s.on("pedido:actualizado", manejar);

  return () => {
    if (temporizador) clearTimeout(temporizador);
    s.off("pedido:creado", manejar);
    s.off("pedido:actualizado", manejar);
  };
}

/** Estado de la conexión en vivo, para poder decirle al usuario que lo que ve puede estar
 *  desactualizado en vez de dejar que lo suponga. */
export function suscribirEstadoConexion(empresaId: string, alCambiar: (enLinea: boolean) => void): () => void {
  const s = obtenerSocket(empresaId);
  const conectar = () => alCambiar(true);
  const desconectar = () => alCambiar(false);

  alCambiar(s.connected);
  s.on("connect", conectar);
  s.on("disconnect", desconectar);

  return () => {
    s.off("connect", conectar);
    s.off("disconnect", desconectar);
  };
}
