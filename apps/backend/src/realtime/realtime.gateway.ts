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
import { WsEventName } from "@hangar421/shared";

/**
 * Gateway central de tiempo real. Salas:
 *  - sucursal:{sucursalId}   -> todos los dispositivos de una sucursal (POS, tablets, cocina)
 *  - estacion:{estacionId}   -> pantallas de cocina filtradas por estación
 *  - empresa:{empresaId}     -> CRM viendo la operación consolidada en vivo
 *  - usuario:{usuarioId}     -> notificaciones dirigidas (p.ej. "tu pedido está listo")
 */
@WebSocketGateway({ cors: { origin: "*" }, path: "/realtime" })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(RealtimeGateway.name);

  handleConnection(client: Socket) {
    this.logger.log(`Cliente conectado: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Cliente desconectado: ${client.id}`);
  }

  @SubscribeMessage("join")
  handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { sucursalId?: string; empresaId?: string; estacionId?: string; usuarioId?: string },
  ) {
    if (body.sucursalId) client.join(`sucursal:${body.sucursalId}`);
    if (body.empresaId) client.join(`empresa:${body.empresaId}`);
    if (body.estacionId) client.join(`estacion:${body.estacionId}`);
    if (body.usuarioId) client.join(`usuario:${body.usuarioId}`);
    return { ok: true, rooms: Array.from(client.rooms) };
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
}
