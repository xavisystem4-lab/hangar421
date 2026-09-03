import { Injectable } from "@nestjs/common";
import { TipoMovimientoInventario, WS_EVENTS, deltaExistenciaInventario } from "@hangar421/shared";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";

@Injectable()
export class InventarioService {
  constructor(private prisma: PrismaService, private realtime: RealtimeGateway) {}

  listarInsumos(empresaId: string) {
    return this.prisma.insumo.findMany({ where: { empresaId, activo: true }, orderBy: { nombre: "asc" } });
  }

  crearInsumo(data: { empresaId: string; nombre: string; unidadMedida: string; costoUnitario?: number }) {
    return this.prisma.insumo.create({ data });
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
