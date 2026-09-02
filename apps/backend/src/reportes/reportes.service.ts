import { Injectable } from "@nestjs/common";
import { EstadoPedido } from "@hangar421/shared";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class ReportesService {
  constructor(private prisma: PrismaService) {}

  /** KPIs del día para el dashboard del CRM, con opción de filtrar por sucursal. */
  async dashboard(empresaId: string, sucursalId?: string) {
    const inicioDia = new Date();
    inicioDia.setHours(0, 0, 0, 0);

    const whereBase = {
      empresaId,
      ...(sucursalId ? { sucursalId } : {}),
      estado: EstadoPedido.COBRADO,
      createdAt: { gte: inicioDia },
    };

    const [pedidosHoy, agregados, topProductos, sucursales] = await Promise.all([
      this.prisma.pedido.count({ where: whereBase }),
      this.prisma.pedido.aggregate({ where: whereBase, _sum: { total: true }, _avg: { total: true } }),
      this.prisma.pedidoItem.groupBy({
        by: ["productoId"],
        where: { pedido: whereBase },
        _sum: { cantidad: true },
        orderBy: { _sum: { cantidad: "desc" } },
        take: 5,
      }),
      this.prisma.sucursal.findMany({
        where: { empresaId, activo: true },
        include: { dispositivos: { where: { activo: true } } },
      }),
    ]);

    const productos = await this.prisma.producto.findMany({
      where: { id: { in: topProductos.map((t) => t.productoId) } },
    });

    return {
      ventasHoy: Number(agregados._sum.total ?? 0),
      ticketPromedio: Number(agregados._avg.total ?? 0),
      pedidosHoy,
      topProductos: topProductos.map((t) => ({
        productoId: t.productoId,
        nombre: productos.find((p) => p.id === t.productoId)?.nombre ?? "—",
        cantidad: t._sum.cantidad ?? 0,
      })),
      estadoSucursales: sucursales.map((s) => ({
        sucursalId: s.id,
        nombre: s.nombre,
        dispositivos: s.dispositivos.map((d) => ({
          id: d.id,
          nombre: d.nombre,
          enLinea: d.ultimaConexion ? Date.now() - d.ultimaConexion.getTime() < 2 * 60_000 : false,
          ultimaConexion: d.ultimaConexion,
        })),
      })),
    };
  }

  /** Ventas agrupadas por hora del día, útil para la gráfica del dashboard. */
  async ventasPorHora(sucursalId: string, fecha?: string) {
    const dia = fecha ? new Date(fecha) : new Date();
    dia.setHours(0, 0, 0, 0);
    const finDia = new Date(dia);
    finDia.setHours(23, 59, 59, 999);

    const pedidos = await this.prisma.pedido.findMany({
      where: { sucursalId, estado: EstadoPedido.COBRADO, createdAt: { gte: dia, lte: finDia } },
      select: { createdAt: true, total: true },
    });

    const porHora = Array.from({ length: 24 }, (_, h) => ({ hora: h, total: 0 }));
    for (const p of pedidos) {
      porHora[p.createdAt.getHours()].total += Number(p.total);
    }
    return porHora;
  }

  async ventasPorProducto(empresaId: string, desde: Date, hasta: Date) {
    return this.prisma.pedidoItem.groupBy({
      by: ["productoId"],
      where: { pedido: { empresaId, estado: EstadoPedido.COBRADO, createdAt: { gte: desde, lte: hasta } } },
      _sum: { cantidad: true },
      _count: true,
    });
  }

  async ventasPorMetodoPago(sucursalId: string, desde: Date, hasta: Date) {
    return this.prisma.pago.groupBy({
      by: ["metodo"],
      where: { pedido: { sucursalId, createdAt: { gte: desde, lte: hasta } } },
      _sum: { monto: true },
      _count: true,
    });
  }
}
