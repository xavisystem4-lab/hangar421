import { Injectable } from "@nestjs/common";
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
