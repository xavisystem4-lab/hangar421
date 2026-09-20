import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { EstadoTurno, MetodoPago, TipoMovimientoCaja } from "@hangar421/shared";
import { PrismaService } from "../prisma/prisma.service";
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
