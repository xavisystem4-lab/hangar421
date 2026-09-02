import { Injectable } from "@nestjs/common";
import { EstadoMesa, WS_EVENTS } from "@hangar421/shared";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";

@Injectable()
export class MesasService {
  constructor(private prisma: PrismaService, private realtime: RealtimeGateway) {}

  listar(sucursalId: string) {
    return this.prisma.mesa.findMany({ where: { sucursalId }, orderBy: { nombre: "asc" } });
  }

  crear(data: { sucursalId: string; areaId?: string; nombre: string; capacidad?: number }) {
    return this.prisma.mesa.create({ data });
  }

  async cambiarEstado(id: string, estado: EstadoMesa) {
    const mesa = await this.prisma.mesa.update({ where: { id }, data: { estado } });
    this.realtime.emitirASucursal(mesa.sucursalId, WS_EVENTS.MESA_ACTUALIZADA, mesa);
    return mesa;
  }
}
