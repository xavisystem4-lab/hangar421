import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { MONEDERO_LIMITE_DEFAULT, agruparConsumosPorEmpleada, type ConsumoCredito } from "@hangar421/shared";
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

/** Clave de "la misma empleada": empresa aparte, primer nombre sin acentos ni mayúsculas. Cada
 *  empleada tiene un usuario por sucursal, pero su crédito es uno solo. */
export function claveEmpleada(nombre: string): string {
  const primero = (nombre ?? "").trim().split(/\s+/)[0] ?? "";
  return primero.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

interface MonederoConUsuario {
  usuarioId: string;
  sucursalId: string | null;
  usuario: { nombre: string; createdAt: Date; sucursales?: { sucursalId: string }[] };
}

/** Un monedero por empleada: el de su sucursal; si no, el del usuario más antiguo. Misma regla
 *  que la migración 20261007190000, por si alguien da de alta otro a mano. */
export function unicosPorNombre<T extends MonederoConUsuario>(monederos: T[]): T[] {
  const enSuSucursal = (m: T) => !!m.sucursalId && (m.usuario.sucursales ?? []).some((s) => s.sucursalId === m.sucursalId);
  const orden = (a: T, b: T) =>
    Number(enSuSucursal(b)) - Number(enSuSucursal(a)) ||
    a.usuario.createdAt.getTime() - b.usuario.createdAt.getTime() ||
    a.usuarioId.localeCompare(b.usuarioId);
  const elegidos = new Map<string, T>();
  for (const m of [...monederos].sort(orden)) {
    const clave = claveEmpleada(m.usuario.nombre);
    if (!elegidos.has(clave)) elegidos.set(clave, m);
  }
  return monederos.filter((m) => elegidos.get(claveEmpleada(m.usuario.nombre)) === m);
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
    const todos = await this.prisma.monederoEmpleado.findMany({
      where: { empresaId, activo: true, usuario: { activo: true, eliminado: false } },
      include: {
        usuario: { select: { nombre: true, createdAt: true, sucursales: { where: { activo: true }, select: { sucursalId: true } } } },
        sucursal: { select: { nombre: true } },
      },
      orderBy: { usuario: { nombre: "asc" } },
    });
    // Una sola por nombre aunque alguien haya dado de alta otra a mano: si no, el cajero vería
    // "Diana" dos veces y el crédito se podría gastar dos veces.
    const monederos = unicosPorNombre(todos);
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

    const usuario = await this.prisma.usuario.findUnique({ where: { id: usuarioId }, select: { empresaId: true, nombre: true } });
    if (!usuario || usuario.empresaId !== empresaId) throw new NotFoundException("Usuario no encontrado");
    if (dto.sucursalId) {
      const sucursal = await this.prisma.sucursal.findUnique({ where: { id: dto.sucursalId }, select: { empresaId: true } });
      if (!sucursal || sucursal.empresaId !== empresaId) throw new BadRequestException("Sucursal inválida");
    }

    // Activar un segundo monedero con el mismo nombre duplicaría el crédito de la empleada.
    if (dto.activo !== false) {
      const activos = await this.prisma.monederoEmpleado.findMany({
        where: { empresaId, activo: true, usuarioId: { not: usuarioId } },
        include: { usuario: { select: { nombre: true } } },
      });
      const repetido = activos.find((m) => claveEmpleada(m.usuario.nombre) === claveEmpleada(usuario.nombre ?? ""));
      if (repetido) {
        throw new BadRequestException(`Ya hay un monedero activo para "${repetido.usuario.nombre}". El crédito es uno solo por empleada: apaga ese primero.`);
      }
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

  /**
   * Reporte de consumo de crédito: cada venta cargada al crédito de una empleada en el rango, con
   * fecha y hora, folio, sucursal y los productos (con sus modificadores). Agrupado por empleada
   * con la misma regla que usa la tablet (agruparConsumosPorEmpleada en shared).
   */
  async reporteConsumos(empresaId: string, filtros: { desde?: string; hasta?: string; sucursalId?: string }) {
    const desde = filtros.desde ? new Date(filtros.desde) : new Date(Date.now() - 7 * 86_400_000);
    const hasta = filtros.hasta ? new Date(filtros.hasta) : new Date();
    if (Number.isNaN(desde.getTime()) || Number.isNaN(hasta.getTime())) throw new BadRequestException("Fechas inválidas.");

    const movimientos = await this.prisma.movimientoMonedero.findMany({
      where: {
        createdAt: { gte: desde, lte: hasta },
        monedero: { empresaId },
        ...(filtros.sucursalId ? { sucursalId: filtros.sucursalId } : {}),
      },
      include: { monedero: { select: { usuario: { select: { nombre: true } } } } },
      orderBy: { createdAt: "desc" },
    });
    if (movimientos.length === 0) return [];

    const pedidos = await this.prisma.pedido.findMany({
      where: { id: { in: movimientos.map((m) => m.pedidoId) }, empresaId },
      select: {
        id: true, folio: true, total: true,
        sucursal: { select: { nombre: true } },
        items: {
          select: {
            cantidad: true, precioUnitario: true,
            producto: { select: { nombre: true } },
            modificadores: { select: { precioExtra: true, opcionModificador: { select: { nombre: true } } } },
          },
        },
      },
    });
    const porId = new Map(pedidos.map((p) => [p.id, p]));

    const consumos: ConsumoCredito[] = movimientos.map((m) => {
      const p = porId.get(m.pedidoId);
      return {
        empleadoId: m.usuarioId,
        empleado: m.monedero.usuario.nombre,
        ventaId: m.pedidoId,
        folio: p?.folio ?? null,
        fecha: m.createdAt.toISOString(),
        sucursal: p?.sucursal.nombre ?? null,
        montoCredito: Number(m.monto),
        totalVenta: p ? Number(p.total) : Number(m.monto),
        productos: (p?.items ?? []).map((it) => ({
          nombre: it.producto.nombre,
          cantidad: it.cantidad,
          precioUnitario: Number(it.precioUnitario),
          modificadores: it.modificadores.map((md) => ({ nombre: md.opcionModificador.nombre, precioExtra: Number(md.precioExtra) })),
        })),
      };
    });
    return agruparConsumosPorEmpleada(consumos);
  }
}
