import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { EstadoPedido, EstadoTurno, MetodoPago, TipoMovimientoCaja } from "@hangar421/shared";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { limiteDelDia } from "../pedidos/ventas-consulta";
import { esTurnoDeDiaAnterior } from "./turnos-consulta";
import { resolverUsuarioDeTerminal } from "../common/usuario-terminal.util";

@Injectable()
export class CajaService {
  constructor(private prisma: PrismaService) {}

  async abrirTurno(data: { sucursalId: string; cajaId?: string | null; usuarioId?: string | null; montoInicial: number }) {
    const cajaId = await this.resolverCaja(data.sucursalId, data.cajaId);
    // `Turno.usuarioId` es obligatorio, así que aquí no vale dejarlo vacío como en el cobro: si
    // el cajero no existe en el ERP se atribuye el turno al usuario-terminal de la sucursal.
    const usuarioId = await resolverUsuarioDeTerminal(this.prisma, data.usuarioId, data.sucursalId);

    const turnoActivo = await this.prisma.turno.findFirst({
      where: { cajaId, estado: EstadoTurno.ABIERTO },
    });
    if (turnoActivo) throw new BadRequestException("Ya existe un turno abierto para esta caja");

    return this.prisma.turno.create({
      data: {
        sucursalId: data.sucursalId,
        cajaId,
        usuarioId,
        montoInicial: data.montoInicial,
      },
    });
  }

  /**
   * Caja contra la que se abre el turno.
   *
   * El APK manda `cajaId: null` a propósito: una tablet no es una caja registrada en el ERP, no
   * tiene con qué rellenar ese campo. Prisma reventaba con
   * `Argument 'cajaId' must not be null` y el corte se quedaba en la cola reintentándose para
   * siempre, arrastrando con él todo lo que viniera detrás en ese lote.
   *
   * Si no viene, se usa la primera caja activa de la sucursal, y si la sucursal no tiene
   * ninguna se crea una. Crear una caja implícita es mucho menos malo que rechazar un corte:
   * el corte es dinero real ya contado, y una sucursal sin caja dada de alta es una omisión de
   * configuración, no una decisión.
   */
  private async resolverCaja(sucursalId: string, cajaId?: string | null): Promise<string> {
    if (cajaId) return cajaId;

    const existente = await this.prisma.caja.findFirst({
      where: { sucursalId, activo: true },
      orderBy: { nombre: "asc" },
      select: { id: true },
    });
    if (existente) return existente.id;

    const creada = await this.prisma.caja.create({
      data: { sucursalId, nombre: "Caja principal" },
      select: { id: true },
    });
    return creada.id;
  }

  /**
   * Cambia de quién es el turno sin cerrar la caja — el relevo de cajero a media jornada.
   *
   * Es seguro porque las ventas ya están enlazadas por `turnoId`: cambiar el responsable NO
   * mueve qué ventas pertenecen al turno, así que el efectivo esperado y el arqueo no se tocan.
   * Antes de esa columna esta operación habría descuadrado el corte, y por eso no existía.
   *
   * Lo que sí cambia es quién responde por el dinero al cerrar, así que se audita siempre. La
   * autorización (PIN/contraseña de un supervisor) la valida quien llama: desde la terminal, el
   * propio APK antes de encolarlo, igual que la cancelación de un ticket — tiene que funcionar
   * sin red.
   */
  async reasignarTurno(turnoId: string, datos: { nuevoUsuarioId?: string | null; autorizadoPorId?: string | null; motivo?: string }) {
    const turno = await this.prisma.turno.findUnique({ where: { id: turnoId } });
    if (!turno) throw new NotFoundException("Turno no encontrado");
    if (turno.estado === EstadoTurno.CERRADO) {
      throw new BadRequestException("El turno ya está cerrado — no se puede cambiar de responsable");
    }

    const nuevoUsuarioId = await resolverUsuarioDeTerminal(this.prisma, datos.nuevoUsuarioId, turno.sucursalId);
    if (nuevoUsuarioId === turno.usuarioId) return turno; // idempotente: reenviar el lote no rompe nada

    const [actualizado] = await this.prisma.$transaction([
      this.prisma.turno.update({ where: { id: turnoId }, data: { usuarioId: nuevoUsuarioId } }),
      this.prisma.auditLog.create({
        data: {
          empresaId: (await this.prisma.sucursal.findUniqueOrThrow({ where: { id: turno.sucursalId }, select: { empresaId: true } })).empresaId,
          sucursalId: turno.sucursalId,
          entidad: "TURNO",
          entidadId: turnoId,
          accion: "REASIGNAR",
          usuarioId: datos.autorizadoPorId ?? nuevoUsuarioId,
          datosAnteriores: { usuarioId: turno.usuarioId },
          datosNuevos: { usuarioId: nuevoUsuarioId, motivo: datos.motivo ?? null },
        },
      }),
    ]);

    return actualizado;
  }

  async turnoActivo(cajaId: string) {
    return this.prisma.turno.findFirst({ where: { cajaId, estado: EstadoTurno.ABIERTO } });
  }

  /** Registra una entrada/salida de efectivo de caja que no es una venta (retiro para cambio,
   *  pago a proveedor de contado, etc.) — se descuenta/suma al esperado en el corte. */
  async registrarMovimiento(data: { turnoId: string; tipo: TipoMovimientoCaja; monto: number; motivo: string; usuarioId?: string | null }) {
    const turno = await this.prisma.turno.findUnique({ where: { id: data.turnoId } });
    if (!turno) throw new NotFoundException("Turno no encontrado");
    if (turno.estado === EstadoTurno.CERRADO) throw new BadRequestException("El turno ya está cerrado");
    if (!(data.monto > 0)) throw new BadRequestException("El monto debe ser mayor a cero");
    if (!data.motivo?.trim()) throw new BadRequestException("El motivo es obligatorio");

    // `MovimientoCaja.usuarioId` es obligatorio y clave foránea, igual que en `Turno`: un retiro
    // registrado por un cajero dado de alta sin conexión reventaría con la misma violación de
    // FK. Se resuelve por el mismo camino antes de que llegue a pasar.
    const usuarioId = await resolverUsuarioDeTerminal(this.prisma, data.usuarioId, turno.sucursalId);

    return this.prisma.movimientoCaja.create({ data: { ...data, usuarioId } });
  }

  async listarMovimientos(turnoId: string) {
    return this.prisma.movimientoCaja.findMany({ where: { turnoId }, orderBy: { createdAt: "desc" } });
  }

  /**
   * Qué ventas pertenecen a este turno.
   *
   * La forma correcta es `pedidos.turnoId`, que la terminal manda desde que existe la columna.
   * Antes había que deducirlo: "ventas de esta sucursal cuyo cajero es el dueño del turno,
   * hechas después de abrirlo". Eso tenía dos agujeros reales:
   *
   *  - Dos cajeros cobrando en el mismo turno: solo contaban las ventas de uno.
   *  - Reasignar el turno a otra persona reescribía retroactivamente qué ventas eran suyas, y el
   *    arqueo se descuadraba solo.
   *
   * Los turnos anteriores a la columna no tienen ninguna venta enlazada, así que para ellos se
   * conserva el criterio viejo: es impreciso, pero es el único dato que existe, y cambiarlo
   * haría que un corte ya cerrado mostrara cifras distintas a las que se firmaron.
   */
  private async filtroVentasDelTurno(turno: { id: string; sucursalId: string; usuarioId: string; fechaApertura: Date }) {
    const enlazadas = await this.prisma.pedido.count({ where: { turnoId: turno.id } });
    if (enlazadas > 0) return { turnoId: turno.id };
    return { sucursalId: turno.sucursalId, cajeroId: turno.usuarioId, createdAt: { gte: turno.fechaApertura } };
  }

  /** Efectivo esperado en caja: monto inicial + ventas en efectivo del turno + ingresos - egresos. */
  private async calcularMontoEsperado(turno: { id: string; sucursalId: string; usuarioId: string; fechaApertura: Date; montoInicial: any }) {
    const filtroPedido = await this.filtroVentasDelTurno(turno);
    const [pagosEfectivo, movimientos] = await Promise.all([
      this.prisma.pago.aggregate({
        where: { metodo: MetodoPago.EFECTIVO, pedido: filtroPedido },
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

  /**
   * Turnos y cortes para el ERP: abiertos y cerrados, con responsable, caja, montos del corte y
   * lo vendido en cada uno.
   *
   * `pendientes` va aparte y NO depende de los filtros: son los turnos abiertos desde un día
   * anterior en las sucursales consultadas, que el ERP tiene que mostrar como alerta aunque el
   * listado esté filtrado a otra cosa (ver esTurnoDeDiaAnterior).
   *
   * Lo vendido sale de las ventas enlazadas por `turnoId`; para un turno anterior a esa columna
   * (sin ninguna enlazada) se usa el mismo criterio heredado que el corte, para que la cifra
   * coincida con la que se firmó al cerrarlo.
   */
  async listarTurnos(
    empresaId: string,
    filtro: { sucursalId?: string; desde?: string; hasta?: string; estado?: EstadoTurno; usuarioId?: string },
  ) {
    const alcance: Prisma.TurnoWhereInput = { sucursal: { empresaId }, ...(filtro.sucursalId ? { sucursalId: filtro.sucursalId } : {}) };
    const zona = await this.zonaHoraria(empresaId, filtro.sucursalId);

    const where: Prisma.TurnoWhereInput = {
      ...alcance,
      ...(filtro.estado ? { estado: filtro.estado } : {}),
      ...(filtro.usuarioId ? { usuarioId: filtro.usuarioId } : {}),
      ...(filtro.desde || filtro.hasta
        ? {
            fechaApertura: {
              ...(filtro.desde ? { gte: limiteDelDia(filtro.desde, zona, "inicio") } : {}),
              ...(filtro.hasta ? { lte: limiteDelDia(filtro.hasta, zona, "fin") } : {}),
            },
          }
        : {}),
    };

    const [turnos, pendientes] = await Promise.all([
      this.prisma.turno.findMany({ where, include: INCLUIR_TURNO, orderBy: { fechaApertura: "desc" }, take: 200 }),
      this.turnosPendientes(empresaId, filtro.sucursalId),
    ]);

    const ventas = await this.ventasPorTurno(turnos);
    return {
      items: turnos.map((t) => ({ ...filaTurno(t), ventas: ventas.get(t.id) ?? { numTickets: 0, total: 0 } })),
      pendientes,
    };
  }

  /**
   * Turnos que siguen abiertos desde un día anterior (en la zona de su sucursal). Es el aviso de
   * "no se cerró el turno de ayer": lo muestran el ERP y el POS al iniciar operaciones. Cualquier
   * rol puede consultarlo para su sucursal — el cajero que abre la tienda es justo quien debe
   * enterarse.
   */
  async turnosPendientes(empresaId: string, sucursalId?: string) {
    const abiertos = await this.prisma.turno.findMany({
      where: { sucursal: { empresaId }, ...(sucursalId ? { sucursalId } : {}), estado: EstadoTurno.ABIERTO },
      include: INCLUIR_TURNO,
      orderBy: { fechaApertura: "asc" },
    });
    return abiertos.filter((t) => esTurnoDeDiaAnterior(t, t.sucursal.timezone)).map(filaTurno);
  }

  private async ventasPorTurno(turnos: { id: string; sucursalId: string; usuarioId: string; fechaApertura: Date; fechaCierre: Date | null }[]) {
    const resultado = new Map<string, { numTickets: number; total: number }>();
    if (turnos.length === 0) return resultado;

    const enlazadas = await this.prisma.pedido.groupBy({
      by: ["turnoId"],
      where: { turnoId: { in: turnos.map((t) => t.id) }, estado: EstadoPedido.COBRADO },
      _count: true,
      _sum: { total: true },
    });
    for (const g of enlazadas) {
      if (g.turnoId) resultado.set(g.turnoId, { numTickets: g._count, total: round2(Number(g._sum.total ?? 0)) });
    }

    // Turnos heredados (ninguna venta enlazada, en ningún estado): criterio del corte antiguo.
    const conAlgunaEnlazada = new Set(
      (await this.prisma.pedido.groupBy({ by: ["turnoId"], where: { turnoId: { in: turnos.map((t) => t.id) } } })).map((g) => g.turnoId),
    );
    await Promise.all(
      turnos
        .filter((t) => !conAlgunaEnlazada.has(t.id))
        .map(async (t) => {
          const agg = await this.prisma.pedido.aggregate({
            where: {
              sucursalId: t.sucursalId,
              cajeroId: t.usuarioId,
              estado: EstadoPedido.COBRADO,
              createdAt: { gte: t.fechaApertura, ...(t.fechaCierre ? { lte: t.fechaCierre } : {}) },
            },
            _count: true,
            _sum: { total: true },
          });
          resultado.set(t.id, { numTickets: agg._count, total: round2(Number(agg._sum.total ?? 0)) });
        }),
    );
    return resultado;
  }

  private async zonaHoraria(empresaId: string, sucursalId?: string): Promise<string> {
    const sucursal = sucursalId
      ? await this.prisma.sucursal.findUnique({ where: { id: sucursalId }, select: { timezone: true } })
      : await this.prisma.sucursal.findFirst({ where: { empresaId, activo: true }, select: { timezone: true } });
    return sucursal?.timezone ?? "America/Mexico_City";
  }

  async resumenTurno(turnoId: string) {
    const turno = await this.prisma.turno.findUniqueOrThrow({ where: { id: turnoId } });
    const filtroPedido = await this.filtroVentasDelTurno(turno);
    const [pagos, movimientos, esperado] = await Promise.all([
      this.prisma.pago.groupBy({
        by: ["metodo"],
        where: { pedido: filtroPedido },
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

const INCLUIR_TURNO = {
  sucursal: { select: { id: true, nombre: true, timezone: true } },
  caja: { select: { id: true, nombre: true } },
  usuario: { select: { id: true, nombre: true } },
} as const;

type TurnoConRelaciones = Prisma.TurnoGetPayload<{ include: typeof INCLUIR_TURNO }>;

function filaTurno(t: TurnoConRelaciones) {
  return {
    id: t.id,
    estado: t.estado,
    fechaApertura: t.fechaApertura,
    fechaCierre: t.fechaCierre,
    sucursal: { id: t.sucursal.id, nombre: t.sucursal.nombre },
    caja: t.caja,
    usuario: t.usuario,
    montoInicial: Number(t.montoInicial),
    montoFinalDeclarado: t.montoFinalDeclarado == null ? null : Number(t.montoFinalDeclarado),
    montoFinalSistema: t.montoFinalSistema == null ? null : Number(t.montoFinalSistema),
    diferencia: t.diferencia == null ? null : Number(t.diferencia),
    pendienteDiaAnterior: esTurnoDeDiaAnterior(t, t.sucursal.timezone),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
