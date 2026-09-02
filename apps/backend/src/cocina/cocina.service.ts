import { Injectable } from "@nestjs/common";
import { EstadoPedido } from "@hangar421/shared";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class CocinaService {
  constructor(private prisma: PrismaService) {}

  /** Comandas visibles en la pantalla de cocina: items de pedidos ya enviados
   *  (no incluye pedidos aún en construcción ni cobrados/cancelados de días previos). */
  async listarComandas(sucursalId: string, estacionCocinaId?: string) {
    const desde = new Date(Date.now() - 12 * 60 * 60 * 1000);
    const items = await this.prisma.pedidoItem.findMany({
      where: {
        pedido: {
          sucursalId,
          estado: { in: [EstadoPedido.ENVIADO, EstadoPedido.EN_PREPARACION, EstadoPedido.LISTO, EstadoPedido.ENTREGADO] },
        },
        createdAt: { gte: desde },
        ...(estacionCocinaId ? { estacionCocinaId } : {}),
      },
      include: {
        producto: true,
        modificadores: { include: { opcionModificador: true } },
        pedido: { include: { mesa: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    return items;
  }
}
