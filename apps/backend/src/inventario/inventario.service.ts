import { BadRequestException, Injectable } from "@nestjs/common";
import { TipoMovimientoInventario, WS_EVENTS, deltaExistenciaInventario } from "@hangar421/shared";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";

@Injectable()
export class InventarioService {
  constructor(private prisma: PrismaService, private realtime: RealtimeGateway) {}

  async listarInsumos(empresaId: string) {
    const insumos = await this.prisma.insumo.findMany({
      where: { empresaId, activo: true },
      include: { proveedor: true },
      orderBy: { nombre: "asc" },
    });
    // Number(...): costoUnitario/precioVenta son Decimal de Prisma — se serializan a JSON como
    // string si se devuelven crudos (ver PedidosPorCobrar.tsx, mismo bug de fondo ya corregido
    // ahí). Se convierten aquí, en el único lugar por el que pasan las respuestas de insumos.
    return insumos.map((i) => ({
      ...i,
      costoUnitario: Number(i.costoUnitario),
      precioVenta: i.precioVenta != null ? Number(i.precioVenta) : null,
    }));
  }

  /** Crea el insumo y, si se dan mínimo/máximo, siembra el registro de inventario (existencia 0)
   *  en TODAS las sucursales de la empresa con ese mismo mínimo/máximo — así, al dar de alta un
   *  insumo, el admin ya no tiene que ir sucursal por sucursal a fijarlo a mano (ver
   *  fijarMinimo, que sigue disponible aparte para ajustarlo por sucursal después). */
  async crearInsumo(data: {
    empresaId: string;
    nombre: string;
    unidadMedida: string;
    costoUnitario?: number;
    precioVenta?: number;
    proveedorId?: string;
    minimo?: number;
    maximo?: number;
  }) {
    const { minimo, maximo, ...insumoData } = data;
    const insumo = await this.prisma.insumo.create({ data: insumoData });

    if (minimo !== undefined || maximo !== undefined) {
      const sucursales = await this.prisma.sucursal.findMany({ where: { empresaId: data.empresaId }, select: { id: true } });
      await this.prisma.$transaction(
        sucursales.map((s) =>
          this.prisma.inventarioSucursal.upsert({
            where: { sucursalId_insumoId: { sucursalId: s.id, insumoId: insumo.id } },
            update: { minimo: minimo ?? 0, maximo },
            create: { sucursalId: s.id, insumoId: insumo.id, existencia: 0, minimo: minimo ?? 0, maximo },
          }),
        ),
      );
    }
    return insumo;
  }

  actualizarInsumo(
    id: string,
    data: Partial<{
      nombre: string;
      unidadMedida: string;
      costoUnitario: number;
      precioVenta: number | null;
      proveedorId: string | null;
      activo: boolean;
    }>,
  ) {
    return this.prisma.insumo.update({ where: { id }, data });
  }

  definirReceta(productoId: string, items: { insumoId: string; cantidad: number }[]) {
    return this.prisma.$transaction(
      items.map((it) =>
        this.prisma.recetaItem.upsert({
          where: { productoId_insumoId: { productoId, insumoId: it.insumoId } },
          update: { cantidad: it.cantidad },
          create: { productoId, insumoId: it.insumoId, cantidad: it.cantidad },
        }),
      ),
    );
  }

  listarReceta(productoId: string) {
    return this.prisma.recetaItem.findMany({ where: { productoId }, include: { insumo: true } });
  }

  eliminarItemReceta(recetaItemId: string) {
    return this.prisma.recetaItem.delete({ where: { id: recetaItemId } });
  }

  async existencias(sucursalId: string) {
    return this.prisma.inventarioSucursal.findMany({
      where: { sucursalId },
      include: { insumo: true },
      orderBy: { insumo: { nombre: "asc" } },
    });
  }

  /** Secciones físicas de la sucursal para el conteo, y en cuál está cada insumo asignado. Las
   *  inactivas también van: la terminal tiene que saber que una sección se dio de baja. */
  async secciones(sucursalId: string) {
    const [secciones, asignaciones] = await Promise.all([
      this.prisma.seccionInventario.findMany({ where: { sucursalId }, orderBy: [{ orden: "asc" }, { nombre: "asc" }] }),
      this.prisma.insumoSeccion.findMany({ where: { sucursalId }, select: { insumoId: true, seccionId: true } }),
    ]);
    return {
      secciones: secciones.map((s) => ({ id: s.id, nombre: s.nombre, orden: s.orden, activo: s.activo })),
      asignaciones,
    };
  }

  /** Alta, renombre o baja de una sección (upsert por id; el id lo genera la terminal). Una
   *  sección de otra sucursal con ese id no se toca (lo frena antes AlcanceSync). */
  async guardarSeccion(sucursalId: string, datos: { id: string; nombre: string; orden?: number; activo?: boolean }) {
    const nombre = String(datos.nombre ?? "").trim().slice(0, 60);
    if (!datos.id || !nombre) throw new BadRequestException("La sección necesita id y nombre");
    return this.prisma.seccionInventario.upsert({
      where: { id: datos.id },
      update: { nombre, orden: datos.orden ?? undefined, activo: datos.activo ?? undefined },
      create: { id: datos.id, sucursalId, nombre, orden: datos.orden ?? 0, activo: datos.activo ?? true },
    });
  }

  /** En qué sección se guarda un insumo en esta sucursal (`seccionId` null = sin sección). */
  async asignarSeccion(sucursalId: string, insumoId: string, seccionId: string | null) {
    if (seccionId) {
      const seccion = await this.prisma.seccionInventario.findUnique({ where: { id: seccionId }, select: { sucursalId: true } });
      // Puede no haber llegado todavía si se creó sin conexión y su alta va detrás en la cola:
      // la cola respeta el orden de creación, así que en la práctica llega antes. Si de verdad no
      // existe, se rechaza y se reintenta.
      if (!seccion) throw new BadRequestException("La sección todavía no existe en el ERP");
      if (seccion.sucursalId !== sucursalId) throw new BadRequestException("La sección pertenece a otra sucursal");
    }
    return this.prisma.insumoSeccion.upsert({
      where: { insumoId_sucursalId: { insumoId, sucursalId } },
      update: { seccionId },
      create: { insumoId, sucursalId, seccionId },
    });
  }

  async alertasStockBajo(sucursalId: string) {
    const existencias = await this.existencias(sucursalId);
    return existencias.filter((e) => Number(e.existencia) <= Number(e.minimo));
  }

  /** Registra un movimiento manual (ENTRADA, AJUSTE, MERMA, CONTEO) y actualiza el saldo. */
  async registrarMovimiento(data: {
    sucursalId: string;
    insumoId: string;
    tipo: TipoMovimientoInventario;
    cantidad: number;
    motivo?: string;
    usuarioId?: string;
    dispositivoId?: string;
    idempotencyKey?: string;
  }) {
    if (data.idempotencyKey) {
      const existente = await this.prisma.movimientoInventario.findUnique({
        where: { idempotencyKey: data.idempotencyKey },
      });
      if (existente) return existente;
    }

    const delta = deltaExistenciaInventario(data.tipo, data.cantidad);

    const [movimiento, inventario] = await this.prisma.$transaction([
      this.prisma.movimientoInventario.create({ data }),
      this.prisma.inventarioSucursal.upsert({
        where: { sucursalId_insumoId: { sucursalId: data.sucursalId, insumoId: data.insumoId } },
        update: { existencia: { increment: delta } },
        create: { sucursalId: data.sucursalId, insumoId: data.insumoId, existencia: Math.max(delta, 0), minimo: 0 },
      }),
    ]);

    if (Number(inventario.existencia) <= Number(inventario.minimo)) {
      this.realtime.emitirASucursal(data.sucursalId, WS_EVENTS.INVENTARIO_ALERTA, inventario);
    }
    return movimiento;
  }

  async fijarMinimo(sucursalId: string, insumoId: string, minimo: number, maximo?: number) {
    return this.prisma.inventarioSucursal.upsert({
      where: { sucursalId_insumoId: { sucursalId, insumoId } },
      update: { minimo, maximo },
      create: { sucursalId, insumoId, minimo, maximo, existencia: 0 },
    });
  }

  listarMovimientos(sucursalId: string, insumoId?: string) {
    return this.prisma.movimientoInventario.findMany({
      where: { sucursalId, ...(insumoId ? { insumoId } : {}) },
      include: { insumo: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }
}
