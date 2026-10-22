import { BadRequestException, Injectable, NotFoundException, Optional, ServiceUnavailableException } from "@nestjs/common";
import { MONEDERO_LIMITE_DEFAULT, agruparConsumosPorEmpleada, htmlReporteCredito, type ConsumoCredito } from "@hangar421/shared";
import { CorreoService } from "../correo/correo.service";
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
  constructor(private prisma: PrismaService, @Optional() private correo?: CorreoService) {}

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
    // Dónde y cuándo puede usarlo: su crédito es solo en SU sucursal y dentro de su horario
    // (ERP → Usuarios → Horarios). Cada empleada puede tener un usuario por sucursal: los horarios
    // de todos sus usuarios (mismo nombre) cuentan.
    const usuarios = await this.prisma.usuario.findMany({
      where: { empresaId, eliminado: false },
      select: { id: true, nombre: true, sucursales: { where: { activo: true }, select: { sucursalId: true } } },
    });
    const idsPorClave = new Map<string, string[]>();
    for (const u of usuarios) {
      const clave = claveEmpleada(u.nombre);
      idsPorClave.set(clave, [...(idsPorClave.get(clave) ?? []), u.id]);
    }
    const idsDe = (m: (typeof monederos)[number]) => idsPorClave.get(claveEmpleada(m.usuario.nombre)) ?? [m.usuarioId];
    const horarios = await this.prisma.horarioUsuario.findMany({
      where: { usuarioId: { in: [...new Set(monederos.flatMap(idsDe))] } },
      select: { usuarioId: true, sucursalId: true, diaSemana: true, horaInicio: true, horaFin: true },
    });
    const sucursalesDe = (m: (typeof monederos)[number]): string[] => {
      if (m.sucursalId) return [m.sucursalId];
      const ids = new Set(idsDe(m));
      return [...new Set(usuarios.filter((u) => ids.has(u.id)).flatMap((u) => u.sucursales.map((s) => s.sucursalId)))];
    };
    return {
      monederos: monederos.map((m) => {
        const ids = new Set(idsDe(m));
        return {
          usuarioId: m.usuarioId,
          nombre: m.usuario.nombre,
          sucursalId: m.sucursalId,
          sucursalNombre: m.sucursal?.nombre ?? null,
          limite: Number(m.limite),
          diaReinicio: m.diaReinicio,
          horaReinicio: m.horaReinicio,
          minutoReinicio: m.minutoReinicio,
          sucursalesPermitidas: sucursalesDe(m),
          horarios: horarios
            .filter((h) => ids.has(h.usuarioId))
            .map((h) => ({ diaSemana: h.diaSemana, horaInicio: h.horaInicio, horaFin: h.horaFin, sucursalId: h.sucursalId })),
        };
      }),
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
      include: { monedero: { select: { limite: true, diaReinicio: true, horaReinicio: true, minutoReinicio: true, usuario: { select: { nombre: true } } } } },
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
    // La regla de cada empleada (tope y reinicio) para que el ERP separe los consumos por semana
    // de crédito: un rango de 7 días casi siempre toma dos periodos y la suma pasaba de $500
    // aunque ninguna semana se pasara. La semana se calcula en el navegador (hora local).
    const reglas = new Map(movimientos.map((m) => [m.usuarioId, {
      limite: Number(m.monedero.limite), diaReinicio: m.monedero.diaReinicio, horaReinicio: m.monedero.horaReinicio, minutoReinicio: m.monedero.minutoReinicio,
    }]));
    return agruparConsumosPorEmpleada(consumos).map((g) => ({ ...g, regla: reglas.get(g.empleadoId) ?? null }));
  }

  /**
   * Manda el reporte de crédito por correo. El cuerpo lo arma el servidor con los datos de la base
   * (no con lo que mande el navegador); el PDF y el Excel los genera el ERP y llegan en base64.
   */
  async enviarReporteConsumos(
    empresaId: string,
    datos: { desde?: string; hasta?: string; sucursalId?: string; destinatarios: string | string[]; mensaje?: string; periodo?: string; pdfBase64?: string; excelBase64?: string },
    enviadoPor?: string,
  ) {
    if (!this.correo) throw new ServiceUnavailableException("El correo no está disponible en este servidor.");
    const destinatarios = CorreoService.normalizarDestinatarios(datos.destinatarios);
    if (destinatarios.length === 0) throw new BadRequestException("Captura al menos un correo válido.");
    const MAX = 8 * 1024 * 1024;
    if ((datos.pdfBase64?.length ?? 0) > MAX || (datos.excelBase64?.length ?? 0) > MAX) throw new BadRequestException("Los archivos son demasiado grandes para enviarse por correo.");

    const grupos = await this.reporteConsumos(empresaId, datos);
    const sucursal = datos.sucursalId ? await this.prisma.sucursal.findUnique({ where: { id: datos.sucursalId }, select: { nombre: true } }) : null;
    const zona = { timeZone: "America/Mexico_City" } as const;
    const fecha = (iso: string) => new Date(iso).toLocaleDateString("es-MX", { ...zona, weekday: "short", day: "2-digit", month: "short", year: "numeric" });
    const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-MX", { ...zona, hour: "2-digit", minute: "2-digit" });
    const periodo = datos.periodo ?? "";
    const nombreSucursal = sucursal?.nombre ?? "Todas las sucursales";
    const html = htmlReporteCredito(grupos, {
      sucursal: nombreSucursal, periodo, fecha, hora,
      mensaje: [datos.mensaje, enviadoPor ? `Enviado por ${enviadoPor}.` : ""].filter(Boolean).join("\n") || undefined,
    });
    const total = grupos.reduce((s, g) => s + g.totalCredito, 0);
    const texto = [
      `Crédito de empleados · ${nombreSucursal} · ${periodo}`,
      `Total: $${total.toFixed(2)}`,
      ...grupos.map((g) => `- ${g.empleado}: $${g.totalCredito.toFixed(2)} (${g.numConsumos} consumo(s))`),
    ].join("\n");
    const base = `credito-empleados-${periodo.replace(/[^\w]+/g, "-")}`.replace(/-+$/, "");
    const adjuntos = [
      ...(datos.pdfBase64 ? [{ nombre: `${base}.pdf`, contenidoBase64: datos.pdfBase64, tipo: "application/pdf" }] : []),
      ...(datos.excelBase64 ? [{ nombre: `${base}.xlsx`, contenidoBase64: datos.excelBase64, tipo: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }] : []),
    ];
    return this.correo.enviar({ destinatarios, asunto: `Crédito de empleados · ${nombreSucursal} · ${periodo}`, html, texto, adjuntos }, empresaId);
  }
}
