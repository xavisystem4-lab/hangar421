import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { EstadoPedido, TipoDispositivo, WS_EVENTS, type VentaHub } from "@hangar421/shared";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { resolverDispositivoId } from "../common/dispositivo.util";

/**
 * Importa en la nube una venta cerrada de un POS de Windows en modo standalone (VentaHub).
 *
 * A diferencia de `PedidosService.crear/cobrar` —que re-precian con el catálogo, numeran un folio
 * nuevo, fechan "ahora" y descuentan inventario por receta— esto guarda la venta TAL COMO SE
 * COBRÓ en el mostrador: totales, fecha y folio originales. El POS ya descontó su inventario
 * local; hacerlo aquí otra vez lo contaría dos veces. Los ids de catálogo y usuarios ya llegan
 * traducidos a los de la nube (los traduce el POS con su tabla de mapeo).
 *
 * Append-only e idempotente por id: reenviar la misma venta no la duplica; una versión posterior
 * (cancelada después de cobrada) actualiza estado y totales y agrega los pagos nuevos, sin borrar
 * nada.
 */
@Injectable()
export class ImportacionHubService {
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeGateway,
  ) {}

  async importarVenta(params: { id: string; empresaId: string; sucursalId: string; huellaHub: string; venta: VentaHub }) {
    const { id, empresaId, sucursalId, huellaHub, venta: v } = params;
    if (v.estado !== EstadoPedido.COBRADO && v.estado !== EstadoPedido.CANCELADO) {
      throw new BadRequestException("Solo se importan ventas cerradas (cobradas o canceladas)");
    }

    // Todo producto y opción tiene que ser de ESTA empresa: los ids vienen del cliente.
    const productoIds = [...new Set(v.items.map((i) => i.productoId))];
    const productos = await this.prisma.producto.findMany({ where: { id: { in: productoIds }, empresaId }, select: { id: true } });
    if (productos.length !== productoIds.length) {
      throw new BadRequestException("La venta usa un producto que no existe en el catálogo de la nube");
    }
    const opcionIds = [...new Set(v.items.flatMap((i) => i.modificadores.map((m) => m.opcionModificadorId)))];
    const opcionesValidas = new Set(
      opcionIds.length === 0
        ? []
        : (
            await this.prisma.opcionModificador.findMany({
              where: { id: { in: opcionIds }, modificador: { empresaId } },
              select: { id: true },
            })
          ).map((o) => o.id),
    );

    const [meseroId, cajeroId] = await Promise.all([this.usuarioDeLaEmpresa(v.meseroId, empresaId), this.usuarioDeLaEmpresa(v.cajeroId, empresaId)]);
    const dispositivoId = await this.dispositivoDeLaVenta(v, sucursalId, huellaHub);
    const creadaEn = new Date(v.creadaEn);
    if (Number.isNaN(creadaEn.getTime())) throw new BadRequestException("Fecha de la venta inválida");

    const existente = await this.prisma.pedido.findUnique({ where: { id }, select: { sucursalId: true } });
    if (existente && existente.sucursalId !== sucursalId) throw new ConflictException("Ya existe una venta con ese id en otra sucursal");

    const pagos = v.pagos.map((p) => ({
      id: p.id,
      pedidoId: id,
      metodo: p.metodo as any,
      monto: p.monto,
      referencia: p.referencia ?? null,
      usuarioId: cajeroId,
      createdAt: creadaEn,
    }));

    await this.prisma.$transaction(async (tx) => {
      if (!existente) {
        await tx.pedido.create({
          data: {
            id,
            empresaId,
            sucursalId,
            folio: folioEnNube(huellaHub, v.folioLocal),
            tipo: v.tipo as any,
            numComensales: v.numComensales ?? 1,
            meseroId,
            cajeroId,
            dispositivoId,
            canalOrigen: v.canalOrigen as any,
            estado: v.estado as any,
            notasGenerales: v.notasGenerales ?? null,
            subtotal: v.subtotal,
            impuesto: v.impuesto,
            descuentoTotal: v.descuentoTotal,
            total: v.total,
            createdAtLocal: creadaEn,
            createdAt: creadaEn,
          },
        });
        for (const item of v.items) {
          await tx.pedidoItem.create({
            data: {
              id: item.id,
              pedidoId: id,
              productoId: item.productoId,
              cantidad: item.cantidad,
              precioUnitario: item.precioUnitario,
              notas: item.notas ?? null,
              estado: "ENTREGADO" as any,
              createdAt: creadaEn,
              modificadores: {
                // Una opción sin equivalente en la nube se omite: el importe ya está en los totales,
                // solo se pierde el detalle de esa línea.
                create: item.modificadores
                  .filter((m) => opcionesValidas.has(m.opcionModificadorId))
                  .map((m) => ({ id: m.id, opcionModificadorId: m.opcionModificadorId, precioExtra: m.precioExtra })),
              },
            },
          });
        }
        if (v.descuentos.length > 0) {
          await tx.descuento.createMany({
            data: v.descuentos.map((d) => ({
              id: d.id,
              pedidoId: id,
              tipo: d.tipo as any,
              valor: d.valor,
              montoAplicado: d.montoAplicado,
              motivo: d.motivo,
              autorizadoPorId: null,
              createdAt: creadaEn,
            })),
            skipDuplicates: true,
          });
        }
      } else {
        // Versión posterior de una venta ya importada (p. ej. cancelada después de cobrada).
        await tx.pedido.update({
          where: { id },
          data: { estado: v.estado as any, cajeroId, subtotal: v.subtotal, impuesto: v.impuesto, descuentoTotal: v.descuentoTotal, total: v.total },
        });
      }
      if (pagos.length > 0) await tx.pago.createMany({ data: pagos, skipDuplicates: true });
    });

    const pedido = await this.prisma.pedido.findUnique({ where: { id } });
    this.realtime.emitirAEmpresa(empresaId, WS_EVENTS.PEDIDO_ACTUALIZADO, pedido);
    return pedido;
  }

  private async usuarioDeLaEmpresa(id: string | null | undefined, empresaId: string): Promise<string | null> {
    if (!id) return null;
    const u = await this.prisma.usuario.findUnique({ where: { id }, select: { empresaId: true } });
    return u && u.empresaId === empresaId ? id : null;
  }

  /** El equipo donde nació la venta (la tablet del mesero o el propio POS) queda registrado en
   *  la nube con su nombre y tipo, para que el Dashboard los distinga. Si no viene, el POS. */
  private async dispositivoDeLaVenta(v: VentaHub, sucursalId: string, huellaHub: string): Promise<string | null> {
    const origen = v.dispositivoOrigen;
    if (!origen?.identificador) return (await resolverDispositivoId(this.prisma, huellaHub, sucursalId)) ?? null;
    const existente = await this.prisma.dispositivo.findUnique({ where: { identificador: origen.identificador }, select: { id: true } });
    if (existente) return existente.id;
    const tipo = (Object.values(TipoDispositivo) as string[]).includes(origen.tipo) ? origen.tipo : TipoDispositivo.OTRO;
    const creado = await this.prisma.dispositivo
      .create({ data: { sucursalId, nombre: origen.nombre || "Dispositivo", tipo: tipo as any, identificador: origen.identificador } })
      .catch(() => this.prisma.dispositivo.findUnique({ where: { identificador: origen.identificador } }));
    return creado?.id ?? null;
  }
}

/** Folio de la venta en la nube: el local con un prefijo del POS. El folio es único por sucursal
 *  y en la misma sucursal pueden vender otros equipos (una tablet, otro POS) con su propia
 *  numeración; el prefijo evita choques y deja ver de qué POS vino. */
export function folioEnNube(huellaHub: string, folioLocal: string): string {
  const sufijo = huellaHub.replace(/[^A-Za-z0-9]/g, "").slice(-4).toUpperCase() || "PC";
  return `PC${sufijo}-${folioLocal}`;
}
