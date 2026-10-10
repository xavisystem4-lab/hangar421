import { Injectable } from "@nestjs/common";
import { EstadoPedido } from "@hangar421/shared";
import { PrismaService } from "../prisma/prisma.service";
import { hoyEnZona, limiteDelDia } from "../pedidos/ventas-consulta";

/** Una variante de un producto en el reporte: la combinación de opciones de modificador con la
 *  que se vendió ("Grande · Leche de avena") y cuántas unidades llevó. */
export interface VarianteVendida {
  descripcion: string;
  cantidad: number;
}

export interface DetalleProductoVendido {
  nombre: string;
  categoria: string | null;
  subcategoria: string | null;
  /** Desglose por modificadores elegidos, de mayor a menor; vacío si el producto no lleva. */
  variantes: VarianteVendida[];
}

const SIN_MODIFICADORES = "Sin modificadores";

@Injectable()
export class ReportesService {
  constructor(private prisma: PrismaService) {}

  /** Nombre + categoría + desglose por modificadores de los productos indicados, para que dos
   *  productos que se llaman igual ("Latte" de Bebidas calientes y "Latte" de DIDI) se distingan
   *  y se vea cuál variante (tamaño, leche, jarabe…) es la que se vende. */
  private async detalleProductos(productoIds: string[], wherePedido: Record<string, unknown>): Promise<Map<string, DetalleProductoVendido>> {
    const detalle = new Map<string, DetalleProductoVendido>();
    if (productoIds.length === 0) return detalle;
    const [productos, items] = await Promise.all([
      this.prisma.producto.findMany({
        where: { id: { in: productoIds } },
        select: { id: true, nombre: true, subcategoria: true, categoria: { select: { nombre: true } } },
      }),
      this.prisma.pedidoItem.findMany({
        where: { productoId: { in: productoIds }, pedido: wherePedido },
        select: {
          productoId: true, cantidad: true,
          modificadores: { select: { opcionModificador: { select: { nombre: true, orden: true, modificador: { select: { nombre: true } } } } } },
        },
      }),
    ]);
    const variantes = new Map<string, Map<string, number>>();
    for (const it of items) {
      const opciones = it.modificadores
        .map((m) => m.opcionModificador)
        .sort((a, b) => a.modificador.nombre.localeCompare(b.modificador.nombre, "es") || a.orden - b.orden)
        .map((o) => o.nombre);
      const clave = opciones.length > 0 ? opciones.join(" · ") : SIN_MODIFICADORES;
      const porVariante = variantes.get(it.productoId) ?? new Map<string, number>();
      porVariante.set(clave, (porVariante.get(clave) ?? 0) + it.cantidad);
      variantes.set(it.productoId, porVariante);
    }
    for (const p of productos) {
      const porVariante = [...(variantes.get(p.id) ?? new Map<string, number>()).entries()]
        .map(([descripcion, cantidad]) => ({ descripcion, cantidad }))
        .sort((a, b) => b.cantidad - a.cantidad || a.descripcion.localeCompare(b.descripcion, "es"));
      // Si la única variante es "sin modificadores", no hay nada que desglosar.
      const soloSinMods = porVariante.length === 1 && porVariante[0].descripcion === SIN_MODIFICADORES;
      detalle.set(p.id, { nombre: p.nombre, categoria: p.categoria?.nombre ?? null, subcategoria: p.subcategoria ?? null, variantes: soloSinMods ? [] : porVariante });
    }
    return detalle;
  }

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

    const detalle = await this.detalleProductos(topProductos.map((t) => t.productoId), whereBase);

    return {
      ventasHoy: Number(agregados._sum.total ?? 0),
      ticketPromedio: Number(agregados._avg.total ?? 0),
      pedidosHoy,
      topProductos: topProductos.map((t) => {
        const d = detalle.get(t.productoId);
        return {
          productoId: t.productoId,
          nombre: d?.nombre ?? "—",
          categoria: d?.categoria ?? null,
          subcategoria: d?.subcategoria ?? null,
          cantidad: t._sum.cantidad ?? 0,
          variantes: d?.variantes ?? [],
        };
      }),
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
  /** Unidades por producto en el rango, con nombre, categoría y desglose por modificadores (se
   *  conservan `_sum`/`_count` por compatibilidad con los clientes que ya los leen). */
  async ventasPorProducto(empresaId: string, desde: Date, hasta: Date, sucursalId?: string) {
    const wherePedido = { empresaId, ...(sucursalId ? { sucursalId } : {}), estado: EstadoPedido.COBRADO, createdAt: { gte: desde, lte: hasta } };
    const grupos = await this.prisma.pedidoItem.groupBy({
      by: ["productoId"],
      where: { pedido: wherePedido },
      _sum: { cantidad: true },
      _count: true,
    });
    const detalle = await this.detalleProductos(grupos.map((g) => g.productoId), wherePedido);
    return grupos.map((g) => {
      const d = detalle.get(g.productoId);
      return {
        ...g,
        nombre: d?.nombre ?? "—",
        categoria: d?.categoria ?? null,
        subcategoria: d?.subcategoria ?? null,
        cantidad: g._sum.cantidad ?? 0,
        variantes: d?.variantes ?? [],
      };
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
