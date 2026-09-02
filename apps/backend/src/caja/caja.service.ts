import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { EstadoTurno, MetodoPago } from "@hangar421/shared";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class CajaService {
  constructor(private prisma: PrismaService) {}

  async abrirTurno(data: { sucursalId: string; cajaId: string; usuarioId: string; montoInicial: number }) {
    const turnoActivo = await this.prisma.turno.findFirst({
      where: { cajaId: data.cajaId, estado: EstadoTurno.ABIERTO },
    });
    if (turnoActivo) throw new BadRequestException("Ya existe un turno abierto para esta caja");

    return this.prisma.turno.create({
      data: {
        sucursalId: data.sucursalId,
        cajaId: data.cajaId,
        usuarioId: data.usuarioId,
        montoInicial: data.montoInicial,
      },
    });
  }

  async turnoActivo(cajaId: string) {
    return this.prisma.turno.findFirst({ where: { cajaId, estado: EstadoTurno.ABIERTO } });
  }

  /** Corte de caja: compara el efectivo declarado por el cajero contra lo esperado
   *  (monto inicial + ventas en efectivo del turno) y registra la diferencia. */
  async cerrarTurno(turnoId: string, montoFinalDeclarado: number) {
    const turno = await this.prisma.turno.findUnique({ where: { id: turnoId } });
    if (!turno) throw new NotFoundException("Turno no encontrado");
    if (turno.estado === EstadoTurno.CERRADO) throw new BadRequestException("El turno ya está cerrado");

    const pagosEfectivo = await this.prisma.pago.aggregate({
      where: {
        metodo: MetodoPago.EFECTIVO,
        pedido: { sucursalId: turno.sucursalId, cajeroId: turno.usuarioId, createdAt: { gte: turno.fechaApertura } },
      },
      _sum: { monto: true },
    });

    const montoFinalSistema = Number(turno.montoInicial) + Number(pagosEfectivo._sum.monto ?? 0);
    const diferencia = round2(montoFinalDeclarado - montoFinalSistema);

    return this.prisma.turno.update({
      where: { id: turnoId },
      data: {
        estado: EstadoTurno.CERRADO,
        fechaCierre: new Date(),
        montoFinalDeclarado,
        montoFinalSistema: round2(montoFinalSistema),
        diferencia,
      },
    });
  }

  async resumenTurno(turnoId: string) {
    const turno = await this.prisma.turno.findUniqueOrThrow({ where: { id: turnoId } });
    const pagos = await this.prisma.pago.groupBy({
      by: ["metodo"],
      where: {
        pedido: { sucursalId: turno.sucursalId, cajeroId: turno.usuarioId, createdAt: { gte: turno.fechaApertura } },
      },
      _sum: { monto: true },
      _count: true,
    });
    return { turno, pagosPorMetodo: pagos };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
