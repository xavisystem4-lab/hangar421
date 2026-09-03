import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { EstadoTurno, MetodoPago, TipoMovimientoCaja } from "@hangar421/shared";
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

  /** Registra una entrada/salida de efectivo de caja que no es una venta (retiro para cambio,
   *  pago a proveedor de contado, etc.) — se descuenta/suma al esperado en el corte. */
  async registrarMovimiento(data: { turnoId: string; tipo: TipoMovimientoCaja; monto: number; motivo: string; usuarioId: string }) {
    const turno = await this.prisma.turno.findUnique({ where: { id: data.turnoId } });
    if (!turno) throw new NotFoundException("Turno no encontrado");
    if (turno.estado === EstadoTurno.CERRADO) throw new BadRequestException("El turno ya está cerrado");
    if (!(data.monto > 0)) throw new BadRequestException("El monto debe ser mayor a cero");
    if (!data.motivo?.trim()) throw new BadRequestException("El motivo es obligatorio");

    return this.prisma.movimientoCaja.create({ data });
  }

  async listarMovimientos(turnoId: string) {
    return this.prisma.movimientoCaja.findMany({ where: { turnoId }, orderBy: { createdAt: "desc" } });
  }

  /** Efectivo esperado en caja: monto inicial + ventas en efectivo del turno + ingresos - egresos. */
  private async calcularMontoEsperado(turno: { id: string; sucursalId: string; usuarioId: string; fechaApertura: Date; montoInicial: any }) {
    const [pagosEfectivo, movimientos] = await Promise.all([
      this.prisma.pago.aggregate({
        where: {
          metodo: MetodoPago.EFECTIVO,
          pedido: { sucursalId: turno.sucursalId, cajeroId: turno.usuarioId, createdAt: { gte: turno.fechaApertura } },
        },
        _sum: { monto: true },
      }),
      this.prisma.movimientoCaja.groupBy({ by: ["tipo"], where: { turnoId: turno.id }, _sum: { monto: true } }),
    ]);

    const ingresos = Number(movimientos.find((m) => m.tipo === TipoMovimientoCaja.INGRESO)?._sum.monto ?? 0);
    const egresos = Number(movimientos.find((m) => m.tipo === TipoMovimientoCaja.EGRESO)?._sum.monto ?? 0);
    const montoEsperado = Number(turno.montoInicial) + Number(pagosEfectivo._sum.monto ?? 0) + ingresos - egresos;
    return { montoEsperado, ingresos, egresos };
  }

  /** Corte de caja: compara el efectivo declarado por el cajero (según el desglose de billetes/
   *  monedas contado) contra lo esperado (monto inicial + ventas en efectivo + ingresos - egresos
   *  del turno) y registra la diferencia. `desgloseEfectivo` guarda el conteo tal cual se
   *  presentó en pantalla, para poder auditarlo después. */
  async cerrarTurno(turnoId: string, montoFinalDeclarado: number, desgloseEfectivo?: unknown) {
    const turno = await this.prisma.turno.findUnique({ where: { id: turnoId } });
    if (!turno) throw new NotFoundException("Turno no encontrado");
    if (turno.estado === EstadoTurno.CERRADO) throw new BadRequestException("El turno ya está cerrado");

    const { montoEsperado } = await this.calcularMontoEsperado(turno);
    const diferencia = round2(montoFinalDeclarado - montoEsperado);

    return this.prisma.turno.update({
      where: { id: turnoId },
      data: {
        estado: EstadoTurno.CERRADO,
        fechaCierre: new Date(),
        montoFinalDeclarado,
        montoFinalSistema: round2(montoEsperado),
        diferencia,
        desgloseEfectivo: desgloseEfectivo as any,
      },
    });
  }

  async resumenTurno(turnoId: string) {
    const turno = await this.prisma.turno.findUniqueOrThrow({ where: { id: turnoId } });
    const [pagos, movimientos, esperado] = await Promise.all([
      this.prisma.pago.groupBy({
        by: ["metodo"],
        where: {
          pedido: { sucursalId: turno.sucursalId, cajeroId: turno.usuarioId, createdAt: { gte: turno.fechaApertura } },
        },
        _sum: { monto: true },
        _count: true,
      }),
      this.listarMovimientos(turnoId),
      this.calcularMontoEsperado(turno),
    ]);
    return {
      turno,
      pagosPorMetodo: pagos,
      movimientos,
      totalIngresos: round2(esperado.ingresos),
      totalEgresos: round2(esperado.egresos),
      montoEsperado: round2(esperado.montoEsperado),
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
