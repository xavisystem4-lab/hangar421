import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import {
  EstadoMesa,
  EstadoPedido,
  EstadoPedidoItem,
  TipoDescuento,
  TipoMovimientoInventario,
  WS_EVENTS,
  calcularMontoDescuento,
  calcularTotalesPedido,
  validarPagoSuficiente,
} from "@hangar421/shared";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import {
  AgregarItemsDto,
  AplicarDescuentoDto,
  CobrarPedidoDto,
  CrearPedidoDto,
} from "./dto/pedido.dto";

@Injectable()
export class PedidosService {
  constructor(private prisma: PrismaService, private realtime: RealtimeGateway) {}

  async listar(sucursalId: string, estado?: EstadoPedido) {
    return this.prisma.pedido.findMany({
      where: { sucursalId, ...(estado ? { estado } : {}) },
      include: { items: { include: { modificadores: true, producto: true } }, pagos: true, mesa: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async obtener(id: string) {
    const pedido = await this.prisma.pedido.findUnique({
      where: { id },
      include: {
        items: { include: { modificadores: { include: { opcionModificador: true } }, producto: true } },
        pagos: true,
        descuentos: true,
        mesa: true,
      },
    });
    if (!pedido) throw new NotFoundException("Pedido no encontrado");
    return pedido;
  }

  /** Crea un pedido de forma idempotente: si `dto.id` ya existe, devuelve el existente
   *  (reintento de sincronización offline no duplica). */
  async crear(dto: CrearPedidoDto) {
    const existente = await this.prisma.pedido.findUnique({ where: { id: dto.id } });
    if (existente) return this.obtener(dto.id);

    const sucursal = await this.prisma.sucursal.findUniqueOrThrow({ where: { id: dto.sucursalId } });
    const folio = await this.generarFolio(dto.sucursalId);

    const itemsResueltos = await Promise.all(
      dto.items.map((item) => this.resolverItem(item)),
    );

    const { subtotal, impuesto, total } = calcularTotalesPedido(itemsResueltos, [], Number(sucursal.tasaImpuesto));

    const pedido = await this.prisma.$transaction(async (tx) => {
      const creado = await tx.pedido.create({
        data: {
          id: dto.id,
          empresaId: dto.empresaId,
          sucursalId: dto.sucursalId,
          mesaId: dto.mesaId,
          clienteId: dto.clienteId,
          folio,
          tipo: dto.tipo,
          numComensales: dto.numComensales ?? 1,
          meseroId: dto.meseroId,
          dispositivoId: dto.dispositivoId,
          canalOrigen: dto.canalOrigen,
          notasGenerales: dto.notasGenerales,
          idempotencyKey: dto.idempotencyKey,
          subtotal,
          impuesto,
          total,
          estado: dto.enviarInmediato ? EstadoPedido.ENVIADO : EstadoPedido.ABIERTO,
          items: {
            create: itemsResueltos.map((it) => ({
              productoId: it.productoId,
              cantidad: it.cantidad,
              precioUnitario: it.precioUnitario,
              notas: it.notas,
              modificadores: {
                create: it.modificadoresSeleccionados.map((m) => ({
                  opcionModificadorId: m.id,
                  precioExtra: m.precioExtra,
                })),
              },
            })),
          },
        },
        include: { items: { include: { modificadores: true } } },
      });

      if (dto.mesaId) {
        await tx.mesa.update({ where: { id: dto.mesaId }, data: { estado: EstadoMesa.OCUPADA } });
      }

      return creado;
    });

    this.realtime.emitirASucursal(dto.sucursalId, WS_EVENTS.PEDIDO_CREADO, pedido);
    this.realtime.emitirAEmpresa(dto.empresaId, WS_EVENTS.PEDIDO_CREADO, pedido);
    if (dto.enviarInmediato) {
      this.realtime.emitirASucursal(dto.sucursalId, WS_EVENTS.COMANDA_NUEVA, pedido);
    }
    if (dto.mesaId) {
      this.realtime.emitirASucursal(dto.sucursalId, WS_EVENTS.MESA_ACTUALIZADA, { id: dto.mesaId, estado: EstadoMesa.OCUPADA });
    }
    return pedido;
  }

  async agregarItems(pedidoId: string, dto: AgregarItemsDto) {
    const pedido = await this.prisma.pedido.findUniqueOrThrow({ where: { id: pedidoId } });
    const itemsResueltos = await Promise.all(dto.items.map((item) => this.resolverItem(item)));

    await this.prisma.$transaction(
      itemsResueltos.map((it) =>
        this.prisma.pedidoItem.create({
          data: {
            pedidoId,
            productoId: it.productoId,
            cantidad: it.cantidad,
            precioUnitario: it.precioUnitario,
            notas: it.notas,
            modificadores: {
              create: it.modificadoresSeleccionados.map((m) => ({
                opcionModificadorId: m.id,
                precioExtra: m.precioExtra,
              })),
            },
          },
        }),
      ),
    );

    await this.recalcularTotales(pedidoId);
    const actualizado = await this.obtener(pedidoId);
    this.realtime.emitirASucursal(pedido.sucursalId, WS_EVENTS.PEDIDO_ACTUALIZADO, actualizado);
    return actualizado;
  }

  async enviarACocina(pedidoId: string) {
    const pedido = await this.prisma.pedido.update({
      where: { id: pedidoId },
      data: { estado: EstadoPedido.ENVIADO },
      include: { items: { include: { producto: true, modificadores: { include: { opcionModificador: true } } } } },
    });
    this.realtime.emitirASucursal(pedido.sucursalId, WS_EVENTS.COMANDA_NUEVA, pedido);
    this.realtime.emitirASucursal(pedido.sucursalId, WS_EVENTS.PEDIDO_ACTUALIZADO, pedido);
    return pedido;
  }

  async cambiarEstadoItem(pedidoId: string, itemId: string, estado: EstadoPedidoItem) {
    const item = await this.prisma.pedidoItem.update({
      where: { id: itemId },
      data: { estado },
      include: { pedido: true },
    });

    const items = await this.prisma.pedidoItem.findMany({ where: { pedidoId } });
    const todosListos = items.every((i) => i.estado === EstadoPedidoItem.LISTO || i.estado === EstadoPedidoItem.CANCELADO);
    const algunoEnPrep = items.some((i) => i.estado === EstadoPedidoItem.EN_PREPARACION);

    let nuevoEstadoPedido: EstadoPedido | undefined;
    if (todosListos) nuevoEstadoPedido = EstadoPedido.LISTO;
    else if (algunoEnPrep) nuevoEstadoPedido = EstadoPedido.EN_PREPARACION;

    let pedidoActualizado = item.pedido;
    if (nuevoEstadoPedido && nuevoEstadoPedido !== item.pedido.estado) {
      pedidoActualizado = await this.prisma.pedido.update({
        where: { id: pedidoId },
        data: { estado: nuevoEstadoPedido },
      });
    }

    this.realtime.emitirASucursal(item.pedido.sucursalId, WS_EVENTS.PEDIDO_ITEM_ACTUALIZADO, item);
    if (nuevoEstadoPedido === EstadoPedido.LISTO) {
      this.realtime.emitirASucursal(item.pedido.sucursalId, WS_EVENTS.COMANDA_LISTA, pedidoActualizado);
      if (item.pedido.meseroId) {
        this.realtime.emitirAUsuario(item.pedido.meseroId, WS_EVENTS.COMANDA_LISTA, pedidoActualizado);
      }
    }
    return item;
  }

  async aplicarDescuento(pedidoId: string, dto: AplicarDescuentoDto) {
    const pedido = await this.prisma.pedido.findUniqueOrThrow({ where: { id: pedidoId } });
    const montoAplicado = calcularMontoDescuento(dto.tipo, dto.valor, Number(pedido.subtotal));

    await this.prisma.descuento.create({
      data: {
        pedidoId,
        tipo: dto.tipo,
        valor: dto.valor,
        montoAplicado,
        motivo: dto.motivo,
        autorizadoPorId: dto.autorizadoPorId,
      },
    });

    await this.recalcularTotales(pedidoId);
    const actualizado = await this.obtener(pedidoId);
    this.realtime.emitirASucursal(pedido.sucursalId, WS_EVENTS.PEDIDO_ACTUALIZADO, actualizado);
    return actualizado;
  }

  /** Cobro: registra pagos, cierra el pedido y descuenta inventario según receta. */
  async cobrar(pedidoId: string, dto: CobrarPedidoDto) {
    const pedido = await this.obtener(pedidoId);
    const { suficiente, totalPagado, faltante } = validarPagoSuficiente(dto.pagos, Number(pedido.total));
    if (!suficiente) {
      throw new BadRequestException(
        `El pago (${totalPagado}) no cubre el total del pedido (${pedido.total}); faltan ${faltante}`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.pago.createMany({
        data: dto.pagos.map((p) => ({
          pedidoId,
          metodo: p.metodo,
          monto: p.monto,
          referencia: p.referencia,
          usuarioId: dto.cajeroId,
        })),
      });
      await tx.pedido.update({
        where: { id: pedidoId },
        data: { estado: EstadoPedido.COBRADO, cajeroId: dto.cajeroId },
      });
      if (pedido.mesaId) {
        await tx.mesa.update({ where: { id: pedido.mesaId }, data: { estado: EstadoMesa.LIBRE } });
      }
    });

    await this.descontarInventarioPorReceta(pedido);

    const actualizado = await this.obtener(pedidoId);
    this.realtime.emitirASucursal(pedido.sucursalId, WS_EVENTS.PEDIDO_ACTUALIZADO, actualizado);
    this.realtime.emitirAEmpresa(pedido.empresaId, WS_EVENTS.PEDIDO_ACTUALIZADO, actualizado);
    if (pedido.mesaId) {
      this.realtime.emitirASucursal(pedido.sucursalId, WS_EVENTS.MESA_ACTUALIZADA, { id: pedido.mesaId, estado: EstadoMesa.LIBRE });
    }
    return actualizado;
  }

  async cancelar(pedidoId: string, motivo: string, autorizadoPorId: string) {
    const pedido = await this.obtener(pedidoId);
    await this.prisma.$transaction(async (tx) => {
      await tx.pedido.update({ where: { id: pedidoId }, data: { estado: EstadoPedido.CANCELADO } });
      await tx.pedidoItem.updateMany({ where: { pedidoId }, data: { estado: EstadoPedidoItem.CANCELADO } });
      if (pedido.mesaId) {
        await tx.mesa.update({ where: { id: pedido.mesaId }, data: { estado: EstadoMesa.LIBRE } });
      }
      await tx.auditLog.create({
        data: {
          empresaId: pedido.empresaId,
          sucursalId: pedido.sucursalId,
          entidad: "PEDIDO",
          entidadId: pedidoId,
          accion: "CANCELAR",
          usuarioId: autorizadoPorId,
          datosNuevos: { motivo },
        },
      });
    });
    const actualizado = await this.obtener(pedidoId);
    this.realtime.emitirASucursal(pedido.sucursalId, WS_EVENTS.PEDIDO_ACTUALIZADO, actualizado);
    return actualizado;
  }

  // -- privados ---------------------------------------------------------------

  private async resolverItem(item: { productoId: string; cantidad: number; notas?: string; modificadores?: { opcionModificadorId: string }[] }) {
    const producto = await this.prisma.producto.findUniqueOrThrow({ where: { id: item.productoId } });
    const opciones = item.modificadores?.length
      ? await this.prisma.opcionModificador.findMany({
          where: { id: { in: item.modificadores.map((m) => m.opcionModificadorId) } },
        })
      : [];

    const modificadoresPrecio = opciones.reduce((acc, o) => acc + Number(o.precioExtra), 0);

    return {
      productoId: item.productoId,
      cantidad: item.cantidad,
      notas: item.notas,
      precioUnitario: Number(producto.precioBase),
      modificadoresPrecio,
      modificadoresSeleccionados: opciones.map((o) => ({ id: o.id, precioExtra: Number(o.precioExtra) })),
    };
  }

  private async recalcularTotales(pedidoId: string) {
    const [pedido, items, descuentos] = await Promise.all([
      this.prisma.pedido.findUniqueOrThrow({ where: { id: pedidoId }, include: { sucursal: true } }),
      this.prisma.pedidoItem.findMany({ where: { pedidoId }, include: { modificadores: true } }),
      this.prisma.descuento.findMany({ where: { pedidoId } }),
    ]);

    const itemsParaTotal = items.map((it) => ({
      precioUnitario: Number(it.precioUnitario),
      cantidad: it.cantidad,
      modificadoresPrecio: it.modificadores.reduce((s, m) => s + Number(m.precioExtra), 0),
    }));
    // los descuentos ya tienen su montoAplicado calculado y persistido (aplicarDescuento); aquí
    // se reexpresan como descuentos de tipo MONTO para reutilizar calcularTotalesPedido.
    const descuentosParaTotal = descuentos.map((d) => ({ tipo: TipoDescuento.MONTO, valor: Number(d.montoAplicado) }));
    const totales = calcularTotalesPedido(itemsParaTotal, descuentosParaTotal, Number(pedido.sucursal.tasaImpuesto));

    await this.prisma.pedido.update({ where: { id: pedidoId }, data: totales });
  }

  private async generarFolio(sucursalId: string): Promise<string> {
    const hoy = new Date();
    const prefijo = `${hoy.getFullYear()}${String(hoy.getMonth() + 1).padStart(2, "0")}${String(hoy.getDate()).padStart(2, "0")}`;
    const conteo = await this.prisma.pedido.count({
      where: { sucursalId, createdAt: { gte: new Date(hoy.setHours(0, 0, 0, 0)) } },
    });
    return `${prefijo}-${String(conteo + 1).padStart(4, "0")}`;
  }

  private async descontarInventarioPorReceta(pedido: Awaited<ReturnType<PedidosService["obtener"]>>) {
    for (const item of pedido.items) {
      const receta = await this.prisma.recetaItem.findMany({ where: { productoId: item.productoId } });
      for (const r of receta) {
        const cantidadDescontar = Number(r.cantidad) * item.cantidad;
        await this.prisma.$transaction(async (tx) => {
          await tx.movimientoInventario.create({
            data: {
              sucursalId: pedido.sucursalId,
              insumoId: r.insumoId,
              tipo: TipoMovimientoInventario.SALIDA,
              cantidad: cantidadDescontar,
              motivo: `Venta pedido ${pedido.folio}`,
              referenciaId: pedido.id,
            },
          });
          const inv = await tx.inventarioSucursal.upsert({
            where: { sucursalId_insumoId: { sucursalId: pedido.sucursalId, insumoId: r.insumoId } },
            update: { existencia: { decrement: cantidadDescontar } },
            create: { sucursalId: pedido.sucursalId, insumoId: r.insumoId, existencia: -cantidadDescontar, minimo: 0 },
          });
          if (Number(inv.existencia) <= Number(inv.minimo)) {
            this.realtime.emitirASucursal(pedido.sucursalId, WS_EVENTS.INVENTARIO_ALERTA, inv);
            this.realtime.emitirAEmpresa(pedido.empresaId, WS_EVENTS.INVENTARIO_ALERTA, inv);
          }
        });
      }
    }
  }
}
