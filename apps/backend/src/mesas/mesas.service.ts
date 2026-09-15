import { BadRequestException, Injectable } from "@nestjs/common";
import { EstadoMesa, WS_EVENTS } from "@hangar421/shared";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";

@Injectable()
export class MesasService {
  constructor(private prisma: PrismaService, private realtime: RealtimeGateway) {}

  listar(sucursalId: string) {
    return this.prisma.mesa.findMany({ where: { sucursalId, activo: true }, orderBy: { nombre: "asc" } });
  }

  crear(data: { sucursalId: string; areaId?: string; nombre: string; capacidad?: number }) {
    return this.prisma.mesa.create({ data });
  }

  // También usado para "eliminar" (baja lógica, { activo: false }) — nunca se borra el registro
  // en sí, conserva el historial de pedidos que ya la referencian (ver Mesa.pedidos). Dar de baja
  // (o cambiar de área) una mesa que no está LIBRE se rechaza: evita desactivar por error la mesa
  // que sigue activa en el salón (motivo original de este endpoint: limpiar duplicados nacidos de
  // una siembra de datos demo corrida más de una vez sobre la misma sucursal).
  async actualizar(id: string, data: { nombre?: string; capacidad?: number; areaId?: string | null; activo?: boolean }) {
    if (data.activo === false) {
      const mesa = await this.prisma.mesa.findUniqueOrThrow({ where: { id } });
      if (mesa.estado !== EstadoMesa.LIBRE) {
        throw new BadRequestException("No se puede eliminar una mesa que no está libre (tiene una cuenta abierta).");
      }
    }
    return this.prisma.mesa.update({ where: { id }, data });
  }

  async cambiarEstado(id: string, estado: EstadoMesa) {
    const mesa = await this.prisma.mesa.update({ where: { id }, data: { estado } });
    this.realtime.emitirASucursal(mesa.sucursalId, WS_EVENTS.MESA_ACTUALIZADA, mesa);
    return mesa;
  }
}
