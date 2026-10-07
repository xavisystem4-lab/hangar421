import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { MONEDERO_LIMITE_DEFAULT } from "@hangar421/shared";
import { PrismaService } from "../prisma/prisma.service";

export interface ConfigurarMonederoDto {
  activo?: boolean;
  limite?: number;
  /** 0 = domingo … 6 = sábado. */
  diaReinicio: number;
  horaReinicio: number;
  minutoReinicio?: number;
  sucursalId?: string | null;
}

/** El periodo más largo entre reinicios es una semana: nada anterior a esto puede afectar un saldo. */
const DIAS_DE_MOVIMIENTOS = 8;

/**
 * Crédito de empleado (monedero electrónico). El backend guarda la regla de cada empleada y sus
 * consumos; el SALDO lo calcula quien lo necesita (la terminal) con las funciones de
 * `@hangar421/shared/monedero`, así que no hay un contador que se desincronice entre tablets.
 */
@Injectable()
export class MonederoService {
  constructor(private prisma: PrismaService) {}

  /** Monederos de la empresa con sus consumos recientes: lo que la terminal guarda para calcular saldos sin red. */
  async paraTerminal(empresaId: string) {
    const monederos = await this.prisma.monederoEmpleado.findMany({
      where: { empresaId, activo: true, usuario: { activo: true, eliminado: false } },
      include: { usuario: { select: { nombre: true } }, sucursal: { select: { nombre: true } } },
      orderBy: { usuario: { nombre: "asc" } },
    });
    const desde = new Date(Date.now() - DIAS_DE_MOVIMIENTOS * 24 * 60 * 60 * 1000);
    const movimientos = await this.prisma.movimientoMonedero.findMany({
      where: { usuarioId: { in: monederos.map((m) => m.usuarioId) }, createdAt: { gte: desde } },
      select: { id: true, usuarioId: true, monto: true, createdAt: true },
    });
    return {
      monederos: monederos.map((m) => ({
        usuarioId: m.usuarioId,
        nombre: m.usuario.nombre,
        sucursalId: m.sucursalId,
        sucursalNombre: m.sucursal?.nombre ?? null,
        limite: Number(m.limite),
        diaReinicio: m.diaReinicio,
        horaReinicio: m.horaReinicio,
        minutoReinicio: m.minutoReinicio,
      })),
      movimientos: movimientos.map((x) => ({ id: x.id, usuarioId: x.usuarioId, monto: Number(x.monto), fecha: x.createdAt.toISOString() })),
    };
  }

  /** Todos los monederos (también los apagados), para administrarlos. */
  listar(empresaId: string) {
    return this.prisma.monederoEmpleado.findMany({
      where: { empresaId },
      include: { usuario: { select: { nombre: true } }, sucursal: { select: { nombre: true } } },
      orderBy: { usuario: { nombre: "asc" } },
    });
  }

  /** Da de alta o cambia el monedero de una empleada (un usuario del sistema). */
  async configurar(empresaId: string, usuarioId: string, dto: ConfigurarMonederoDto) {
    const dia = Number(dto.diaReinicio);
    const hora = Number(dto.horaReinicio);
    const minuto = Number(dto.minutoReinicio ?? 0);
    if (!Number.isInteger(dia) || dia < 0 || dia > 6) throw new BadRequestException("diaReinicio debe ser de 0 (domingo) a 6 (sábado)");
    if (!Number.isInteger(hora) || hora < 0 || hora > 23) throw new BadRequestException("horaReinicio debe ser de 0 a 23");
    if (!Number.isInteger(minuto) || minuto < 0 || minuto > 59) throw new BadRequestException("minutoReinicio debe ser de 0 a 59");
    const limite = dto.limite ?? MONEDERO_LIMITE_DEFAULT;
    if (!(Number(limite) > 0)) throw new BadRequestException("El límite del monedero debe ser mayor que 0");

    const usuario = await this.prisma.usuario.findUnique({ where: { id: usuarioId }, select: { empresaId: true } });
    if (!usuario || usuario.empresaId !== empresaId) throw new NotFoundException("Usuario no encontrado");
    if (dto.sucursalId) {
      const sucursal = await this.prisma.sucursal.findUnique({ where: { id: dto.sucursalId }, select: { empresaId: true } });
      if (!sucursal || sucursal.empresaId !== empresaId) throw new BadRequestException("Sucursal inválida");
    }

    const datos = {
      limite: Number(limite),
      diaReinicio: dia,
      horaReinicio: hora,
      minutoReinicio: minuto,
      activo: dto.activo ?? true,
      ...(dto.sucursalId !== undefined ? { sucursalId: dto.sucursalId } : {}),
    };
    return this.prisma.monederoEmpleado.upsert({
      where: { usuarioId },
      create: { usuarioId, empresaId, ...datos },
      update: datos,
    });
  }
}
