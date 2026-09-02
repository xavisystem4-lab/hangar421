import { BadRequestException, Injectable } from "@nestjs/common";
import { EstadoTraspaso, TipoMovimientoInventario, calcularDiferenciaTraspaso } from "@hangar421/shared";
import { PrismaService } from "../prisma/prisma.service";
import { InventarioService } from "../inventario/inventario.service";

/** Flujo: SOLICITADO -> AUTORIZADO -> ENVIADO -> RECIBIDO -> VALIDADO (o CANCELADO en cualquier punto anterior a ENVIADO). */
@Injectable()
export class TraspasosService {
  constructor(private prisma: PrismaService, private inventario: InventarioService) {}

  listar(sucursalId: string) {
    return this.prisma.traspaso.findMany({
      where: { OR: [{ sucursalOrigenId: sucursalId }, { sucursalDestinoId: sucursalId }] },
      include: { items: { include: { insumo: true } } },
      orderBy: { fechaSolicitud: "desc" },
    });
  }

  solicitar(data: {
    sucursalOrigenId: string;
    sucursalDestinoId: string;
    usuarioSolicitaId: string;
    notas?: string;
    items: { insumoId: string; cantidadSolicitada: number }[];
  }) {
    return this.prisma.traspaso.create({
      data: {
        sucursalOrigenId: data.sucursalOrigenId,
        sucursalDestinoId: data.sucursalDestinoId,
        usuarioSolicitaId: data.usuarioSolicitaId,
        notas: data.notas,
        items: { create: data.items },
      },
      include: { items: true },
    });
  }

  async autorizar(id: string, usuarioAutorizaId: string) {
    await this.validarTransicion(id, EstadoTraspaso.SOLICITADO);
    return this.prisma.traspaso.update({
      where: { id },
      data: { estado: EstadoTraspaso.AUTORIZADO, usuarioAutorizaId, fechaAutorizacion: new Date() },
    });
  }

  /** Envío: descuenta de la sucursal origen (movimiento TRASPASO_SALIDA) y registra cantidad enviada. */
  async enviar(id: string, usuarioEnviaId: string, cantidadesEnviadas: { itemId: string; cantidad: number }[]) {
    const traspaso = await this.validarTransicion(id, EstadoTraspaso.AUTORIZADO);

    await this.prisma.$transaction(async (tx) => {
      for (const c of cantidadesEnviadas) {
        const item = traspaso.items.find((i) => i.id === c.itemId);
        if (!item) continue;
        await tx.traspasoItem.update({ where: { id: c.itemId }, data: { cantidadEnviada: c.cantidad } });
      }
      await tx.traspaso.update({
        where: { id },
        data: { estado: EstadoTraspaso.ENVIADO, usuarioEnviaId, fechaEnvio: new Date() },
      });
    });

    for (const c of cantidadesEnviadas) {
      const item = traspaso.items.find((i) => i.id === c.itemId);
      if (!item) continue;
      await this.inventario.registrarMovimiento({
        sucursalId: traspaso.sucursalOrigenId,
        insumoId: item.insumoId,
        tipo: TipoMovimientoInventario.TRASPASO_SALIDA,
        cantidad: c.cantidad,
        motivo: `Traspaso ${id} -> sucursal destino`,
      });
    }
    return this.obtener(id);
  }

  /** Recepción: registra cantidad recibida y calcula diferencia vs. lo enviado. */
  async recibir(id: string, usuarioRecibeId: string, cantidadesRecibidas: { itemId: string; cantidad: number }[]) {
    const traspaso = await this.validarTransicion(id, EstadoTraspaso.ENVIADO);

    await this.prisma.$transaction(async (tx) => {
      for (const c of cantidadesRecibidas) {
        const item = traspaso.items.find((i) => i.id === c.itemId);
        if (!item) continue;
        const diferencia = calcularDiferenciaTraspaso(Number(item.cantidadEnviada ?? 0), c.cantidad);
        await tx.traspasoItem.update({
          where: { id: c.itemId },
          data: { cantidadRecibida: c.cantidad, diferencia },
        });
      }
      await tx.traspaso.update({
        where: { id },
        data: { estado: EstadoTraspaso.RECIBIDO, usuarioRecibeId, fechaRecepcion: new Date() },
      });
    });

    for (const c of cantidadesRecibidas) {
      const item = traspaso.items.find((i) => i.id === c.itemId);
      if (!item) continue;
      await this.inventario.registrarMovimiento({
        sucursalId: traspaso.sucursalDestinoId,
        insumoId: item.insumoId,
        tipo: TipoMovimientoInventario.TRASPASO_ENTRADA,
        cantidad: c.cantidad,
        motivo: `Traspaso ${id} recibido`,
      });
    }
    return this.obtener(id);
  }

  /** Validación final: confirma diferencias (mermas en tránsito) y cierra el traspaso. */
  async validar(id: string) {
    await this.validarTransicion(id, EstadoTraspaso.RECIBIDO);
    return this.prisma.traspaso.update({
      where: { id },
      data: { estado: EstadoTraspaso.VALIDADO, fechaValidacion: new Date() },
    });
  }

  async cancelar(id: string) {
    const traspaso = await this.prisma.traspaso.findUniqueOrThrow({ where: { id } });
    if (traspaso.estado === EstadoTraspaso.ENVIADO || traspaso.estado === EstadoTraspaso.RECIBIDO || traspaso.estado === EstadoTraspaso.VALIDADO) {
      throw new BadRequestException("No se puede cancelar un traspaso ya enviado");
    }
    return this.prisma.traspaso.update({ where: { id }, data: { estado: EstadoTraspaso.CANCELADO } });
  }

  private obtener(id: string) {
    return this.prisma.traspaso.findUniqueOrThrow({ where: { id }, include: { items: true } });
  }

  private async validarTransicion(id: string, estadoEsperado: EstadoTraspaso) {
    const traspaso = await this.prisma.traspaso.findUniqueOrThrow({ where: { id }, include: { items: true } });
    if (traspaso.estado !== estadoEsperado) {
      throw new BadRequestException(`El traspaso debe estar en estado ${estadoEsperado} (actual: ${traspaso.estado})`);
    }
    return traspaso;
  }
}
