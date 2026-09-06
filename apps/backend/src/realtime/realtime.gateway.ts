import { Logger } from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { WS_EVENTS, WsEventName } from "@hangar421/shared";

export interface ClienteConectado {
  /** = socketId — se expone con este nombre en la API/panel de Administración porque describe
   *  mejor qué es para quien lo lee ahí ("sesión", no un detalle interno de Socket.IO): se
   *  regenera en cada conexión/reconexión, así que identifica la SESIÓN viva actual, no el
   *  dispositivo en sí (para eso está `dispositivoId`, estable entre reconexiones). */
  socketId: string;
  dispositivoId?: string;
  nombreDispositivo?: string;
  usuarioId?: string;
  usuarioNombre?: string;
  sucursalId?: string;
  /** "mesero" | "pos" | "cocina" | otro — quién se identificó al hacer `join`. Lo usa el panel
   *  de Administración para filtrar solo tablets de meseros, no cada backend/kiosco que se
   *  conecta al mismo canal. */
  tipo?: string;
  /** "tablet" | "celular" — lo manda la app de Meseros según `useDispositivo().esTablet` (ver
   *  App.tsx del waiter-mobile). Puramente informativo para el panel de Administración; no se
   *  usa para ninguna lógica de negocio. */
  tipoDispositivo?: string;
  /** Versión de la app que envía el `join` (ej. "0.1.9") — puramente informativo. */
  appVersion?: string;
  /** Sistema operativo del dispositivo (ej. "android") — puramente informativo. */
  so?: string;
  ip: string;
  conectadoDesde: string;
  /** Se actualiza en cada conexión y en cada "mesero:heartbeat" — es lo que el panel de
   *  Administración muestra como "Último heartbeat". El propio heartbeat de transporte de
   *  Socket.IO (ping/pong) ya detecta solo una conexión caída sin que nadie llame a esto — este
   *  campo es puramente para mostrarle al admin una prueba de vida explícita, a nivel de
   *  aplicación, no para la lógica de desconexión en sí. */
  ultimoHeartbeat: string;
}

/**
 * Gateway central de tiempo real. Salas:
 *  - sucursal:{sucursalId}   -> todos los dispositivos de una sucursal (POS, tablets, cocina)
 *  - estacion:{estacionId}   -> pantallas de cocina filtradas por estación
 *  - empresa:{empresaId}     -> CRM viendo la operación consolidada en vivo
 *  - usuario:{usuarioId}     -> notificaciones dirigidas (p.ej. "tu pedido está listo")
 */
@WebSocketGateway({
  cors: { origin: "*" },
  path: "/realtime",
  // Heartbeat de transporte explícito y afinado (antes usaba el default de Socket.IO,
  // 25s/20s — hasta ~45s peor caso para notar una conexión caída). Con esto, un cierre forzado
  // del software de PC (proceso terminado, apagón, cable de red desconectado, Wi-Fi perdido)
  // se refleja en el cliente vía el evento nativo "disconnect" en ~18s peor caso, sin ningún
  // código adicional de heartbeat de aplicación — eso es solo para el dato "Último heartbeat"
  // que se muestra en el panel de Administración (ver ClienteConectado.ultimoHeartbeat).
  pingInterval: 10_000,
  pingTimeout: 8_000,
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(RealtimeGateway.name);

  /** Clientes conectados ahora mismo, en memoria (no persistido — se reconstruye solo con cada
   *  conexión/desconexión). Lo usa Administración → "Conexión Meseros" para mostrar qué
   *  tablets están conectadas y con qué IP, así el admin puede confirmar de un vistazo que
   *  todas las tablets del local sí llegaron a esta Estación. */
  private clientes = new Map<string, ClienteConectado>();

  handleConnection(client: Socket) {
    const ahora = new Date().toISOString();
    this.clientes.set(client.id, {
      socketId: client.id,
      ip: this.obtenerIp(client),
      conectadoDesde: ahora,
      ultimoHeartbeat: ahora,
    });
    this.logger.log(`Cliente conectado: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.clientes.delete(client.id);
    this.logger.log(`Cliente desconectado: ${client.id}`);
  }

  @SubscribeMessage("join")
  handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    body: {
      sucursalId?: string;
      empresaId?: string;
      estacionId?: string;
      usuarioId?: string;
      dispositivoId?: string;
      nombreDispositivo?: string;
      usuarioNombre?: string;
      tipo?: string;
      tipoDispositivo?: string;
      appVersion?: string;
      so?: string;
    },
  ) {
    if (body.sucursalId) client.join(`sucursal:${body.sucursalId}`);
    if (body.empresaId) client.join(`empresa:${body.empresaId}`);
    if (body.estacionId) client.join(`estacion:${body.estacionId}`);
    if (body.usuarioId) client.join(`usuario:${body.usuarioId}`);

    const existente = this.clientes.get(client.id);
    if (existente) {
      existente.sucursalId = body.sucursalId ?? existente.sucursalId;
      existente.usuarioId = body.usuarioId ?? existente.usuarioId;
      existente.usuarioNombre = body.usuarioNombre ?? existente.usuarioNombre;
      existente.dispositivoId = body.dispositivoId ?? existente.dispositivoId;
      existente.nombreDispositivo = body.nombreDispositivo ?? existente.nombreDispositivo;
      existente.tipo = body.tipo ?? existente.tipo;
      existente.tipoDispositivo = body.tipoDispositivo ?? existente.tipoDispositivo;
      existente.appVersion = body.appVersion ?? existente.appVersion;
      existente.so = body.so ?? existente.so;
    }

    return { ok: true, rooms: Array.from(client.rooms), sessionId: client.id };
  }

  /** Prueba de vida a nivel de aplicación — ver el comentario de `ultimoHeartbeat` en
   *  ClienteConectado. La app de Meseros la emite cada N segundos mientras el socket esté
   *  conectado (ver api/socket.ts del waiter-mobile). */
  @SubscribeMessage("mesero:heartbeat")
  handleHeartbeat(@ConnectedSocket() client: Socket) {
    const existente = this.clientes.get(client.id);
    if (existente) existente.ultimoHeartbeat = new Date().toISOString();
  }

  /** Tablets de meseros conectadas AHORA MISMO a una sucursal — una por dispositivo (si el
   *  mismo dispositivo tiene más de un socket vivo, por ejemplo tras una reconexión que tardó en
   *  cerrar la anterior, se queda con la más reciente), ordenadas por tiempo de conexión
   *  descendente. */
  listarConectados(sucursalId: string): ClienteConectado[] {
    const porDispositivo = new Map<string, ClienteConectado>();
    for (const c of this.clientes.values()) {
      if (c.sucursalId !== sucursalId || c.tipo !== "mesero") continue;
      const clave = c.dispositivoId ?? c.socketId;
      const previo = porDispositivo.get(clave);
      if (!previo || c.conectadoDesde > previo.conectadoDesde) porDispositivo.set(clave, c);
    }
    return Array.from(porDispositivo.values()).sort((a, b) => (a.conectadoDesde < b.conectadoDesde ? 1 : -1));
  }

  emitirASucursal(sucursalId: string, evento: WsEventName, payload: unknown) {
    this.server.to(`sucursal:${sucursalId}`).emit(evento, payload);
  }

  emitirAEmpresa(empresaId: string, evento: WsEventName, payload: unknown) {
    this.server.to(`empresa:${empresaId}`).emit(evento, payload);
  }

  emitirAEstacion(estacionId: string, evento: WsEventName, payload: unknown) {
    this.server.to(`estacion:${estacionId}`).emit(evento, payload);
  }

  emitirAUsuario(usuarioId: string, evento: WsEventName, payload: unknown) {
    this.server.to(`usuario:${usuarioId}`).emit(evento, payload);
  }

  /** Aviso de cierre LIMPIO del software de PC — llamado desde
   *  RealtimeController.anunciarCierre() (POST /realtime/anunciar-cierre), que a su vez llama
   *  electron/backend-manager.ts justo antes de matar el proceso del backend embebido. Un
   *  cierre FORZADO (proceso terminado a la fuerza, apagón, red caída) nunca llega a este
   *  método — ese caso lo detecta solo el heartbeat de transporte (pingInterval/pingTimeout de
   *  arriba) cuando la conexión se cae sin avisar. */
  anunciarCierre() {
    this.server.emit(WS_EVENTS.SERVIDOR_CERRANDO, {});
    this.logger.log("Aviso de cierre limpio emitido a todos los clientes conectados");
  }

  /** `handshake.address` puede venir como "::ffff:192.168.1.55" (IPv4 mapeada a IPv6) — se
   *  limpia el prefijo para mostrar la IP tal como la reconocería un humano. */
  private obtenerIp(client: Socket): string {
    const cruda = client.handshake.address ?? "";
    return cruda.replace(/^::ffff:/, "");
  }
}
