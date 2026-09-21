import { Injectable } from "@nestjs/common";
import { EstadoPedido } from "@hangar421/shared";
import { PrismaService } from "../prisma/prisma.service";
import { hoyEnZona, limiteDelDia } from "../pedidos/ventas-consulta";

@Injectable()
export class ReportesService {
  constructor(private prisma: PrismaService) {}

  /** KPIs del día para el dashboard del CRM, con opción de filtrar por sucursal.
   *
   *  "Hoy" es el día en la zona de la SUCURSAL, no en la del servidor: Railway corre en UTC, y
   *  `new Date().setHours(0,0,0,0)` daba las 00:00 UTC — las 18:00 del día anterior en México.
   *  Con eso el dashboard mezclaba la tarde-noche de ayer con la de hoy y cortaba el día a las
   *  18:00. Misma regla que el módulo de Ventas, para que los dos números coincidan siempre. */
  async dashboard(empresaId: string, sucursalId?: string) {
    const zona = await this.zonaHoraria(empresaId, sucursalId);
    const inicioDia = limiteDelDia(hoyEnZona(zona), zona, "inicio");

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

  /** Ventas agrupadas por hora del día, útil para la gráfica del dashboard.
   *
   *  Tanto el corte del día como la hora de cada venta van en la zona de la sucursal: con la del
   *  servidor, una venta de las 14:00 en México aparecía en la barra de las 20:00. */
  async ventasPorHora(sucursalId: string, fecha?: string) {
    const zona = await this.zonaHoraria(undefined, sucursalId);
    const dia = fecha ?? hoyEnZona(zona);

    const pedidos = await this.prisma.pedido.findMany({
      where: {
        sucursalId,
        estado: EstadoPedido.COBRADO,
        createdAt: { gte: limiteDelDia(dia, zona, "inicio"), lte: limiteDelDia(dia, zona, "fin") },
      },
      select: { createdAt: true, total: true },
    });

    const formatoHora = new Intl.DateTimeFormat("en-US", { timeZone: zona, hour12: false, hour: "2-digit" });
    const porHora = Array.from({ length: 24 }, (_, h) => ({ hora: h, total: 0 }));
    for (const p of pedidos) {
      const hora = Number(formatoHora.format(p.createdAt)) % 24;
      porHora[hora].total += Number(p.total);
    }
    return porHora;
  }

  /** Zona horaria de la sucursal; si no se da una, la de la primera sucursal activa de la
   *  empresa. El esquema tiene default America/Mexico_City, así que siempre hay valor. */
  private async zonaHoraria(empresaId?: string, sucursalId?: string): Promise<string> {
    const sucursal = sucursalId
      ? await this.prisma.sucursal.findUnique({ where: { id: sucursalId }, select: { timezone: true } })
      : await this.prisma.sucursal.findFirst({ where: { empresaId, activo: true }, select: { timezone: true } });
    return sucursal?.timezone ?? "America/Mexico_City";
  }

  /** `sucursalId` opcional: sin él es el consolidado de la empresa (antes no había forma de
   *  pedirlo por sucursal, así que el reporte de una sucursal mostraba lo de todas). */
  async ventasPorProducto(empresaId: string, desde: Date, hasta: Date, sucursalId?: string) {
    return this.prisma.pedidoItem.groupBy({
      by: ["productoId"],
      where: {
        pedido: { empresaId, ...(sucursalId ? { sucursalId } : {}), estado: EstadoPedido.COBRADO, createdAt: { gte: desde, lte: hasta } },
      },
      _sum: { cantidad: true },
      _count: true,
    });
  }

  /** Solo pedidos COBRADOS: antes sumaba también los pagos de pedidos cancelados, y el total por
   *  método de pago no cuadraba con el total vendido. */
  async ventasPorMetodoPago(sucursalId: string, desde: Date, hasta: Date) {
    return this.prisma.pago.groupBy({
      by: ["metodo"],
      where: { pedido: { sucursalId, estado: EstadoPedido.COBRADO, createdAt: { gte: desde, lte: hasta } } },
      _sum: { monto: true },
      _count: true,
    });
  }
}
