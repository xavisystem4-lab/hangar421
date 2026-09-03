import { Injectable, Logger } from "@nestjs/common";
import {
  CanalOrigen,
  EstadoPedidoItem,
  SyncChange,
  SyncEntidad,
  SyncEnvelope,
  SyncItemResult,
  SyncOperacion,
  SyncPullResponse,
  SyncStatus,
} from "@hangar421/shared";
import { PrismaService } from "../prisma/prisma.service";
import { resolverDispositivoId } from "../common/dispositivo.util";
import { PedidosService } from "../pedidos/pedidos.service";
import { MesasService } from "../mesas/mesas.service";
import { InventarioService } from "../inventario/inventario.service";
import { CajaService } from "../caja/caja.service";

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private prisma: PrismaService,
    private pedidos: PedidosService,
    private mesas: MesasService,
    private inventario: InventarioService,
    private caja: CajaService,
  ) {}

  /** Aplica un lote de operaciones offline. Idempotente: reenviar el mismo lote
   *  (reintento de red) no duplica nada — se identifica por `idempotencyKey`. */
  async push(items: SyncEnvelope[]): Promise<{ resultados: SyncItemResult[]; serverTime: string }> {
    const resultados: SyncItemResult[] = [];

    for (const item of items) {
      resultados.push(await this.aplicarItem(item));
    }

    // marca al dispositivo como visto (usado por CRM para "en línea / offline")
    const dispositivoId = items[0]?.dispositivoId;
    if (dispositivoId) {
      await this.prisma.dispositivo
        .update({ where: { id: dispositivoId }, data: { ultimaConexion: new Date() } })
        .catch(() => undefined);
    }

    return { resultados, serverTime: new Date().toISOString() };
  }

  private async aplicarItem(item: SyncEnvelope): Promise<SyncItemResult> {
    const previo = await this.prisma.syncQueueItem.findUnique({ where: { idempotencyKey: item.idempotencyKey } });
    if (previo?.estado === SyncStatus.SYNCED) {
      return { id: item.id, idempotencyKey: item.idempotencyKey, estado: SyncStatus.SYNCED };
    }

    // `SyncQueueItem.dispositivoId` es una llave foránea obligatoria hacia Dispositivo.id —
    // se resuelve/autoregistra la huella que manda el cliente antes de usarla (ver dispositivo.util.ts).
    const dispositivoId = (await resolverDispositivoId(this.prisma, item.dispositivoId, item.sucursalId)) ?? item.dispositivoId;

    try {
      await this.enrutar(item);
      await this.prisma.syncQueueItem.upsert({
        where: { idempotencyKey: item.idempotencyKey },
        update: { estado: SyncStatus.SYNCED, syncedAt: new Date(), intentos: { increment: 1 } },
        create: {
          dispositivoId,
          entidad: item.entidad,
          entidadId: item.id,
          operacion: item.operacion,
          payload: item.payload as any,
          idempotencyKey: item.idempotencyKey,
          estado: SyncStatus.SYNCED,
          intentos: 1,
          syncedAt: new Date(),
        },
      });
      return { id: item.id, idempotencyKey: item.idempotencyKey, estado: SyncStatus.SYNCED };
    } catch (error: any) {
      this.logger.warn(`Fallo al aplicar ${item.entidad}/${item.operacion} (${item.id}): ${error.message}`);
      await this.prisma.syncQueueItem.upsert({
        where: { idempotencyKey: item.idempotencyKey },
        update: { estado: SyncStatus.ERROR, ultimoError: error.message, intentos: { increment: 1 } },
        create: {
          dispositivoId,
          entidad: item.entidad,
          entidadId: item.id,
          operacion: item.operacion,
          payload: item.payload as any,
          idempotencyKey: item.idempotencyKey,
          estado: SyncStatus.ERROR,
          ultimoError: error.message,
          intentos: 1,
        },
      });
      return { id: item.id, idempotencyKey: item.idempotencyKey, estado: SyncStatus.ERROR, error: error.message };
    }
  }

  private async enrutar(item: SyncEnvelope) {
    const p = item.payload as any;
    switch (item.entidad) {
      case SyncEntidad.PEDIDO:
        if (item.operacion === SyncOperacion.CREATE) {
          await this.pedidos.crear({
            id: item.id,
            empresaId: p.empresaId,
            sucursalId: item.sucursalId,
            mesaId: p.mesaId,
            clienteId: p.clienteId,
            tipo: p.tipo,
            numComensales: p.numComensales,
            meseroId: p.meseroId ?? item.usuarioId,
            dispositivoId: item.dispositivoId,
            canalOrigen: p.canalOrigen ?? CanalOrigen.APP_MESERO,
            notasGenerales: p.notasGenerales,
            idempotencyKey: item.idempotencyKey,
            items: p.items,
          });
        }
        break;

      case SyncEntidad.PEDIDO_ITEM:
        if (item.operacion === SyncOperacion.UPDATE) {
          await this.pedidos.cambiarEstadoItem(p.pedidoId, item.id, p.estado as EstadoPedidoItem);
        }
        break;

      case SyncEntidad.PAGO:
        await this.pedidos.cobrar(p.pedidoId, { pagos: p.pagos, cajeroId: p.cajeroId ?? item.usuarioId });
        break;

      case SyncEntidad.DESCUENTO:
        await this.pedidos.aplicarDescuento(p.pedidoId, {
          tipo: p.tipo,
          valor: p.valor,
          motivo: p.motivo,
          autorizadoPorId: p.autorizadoPorId,
        });
        break;

      case SyncEntidad.MESA:
        await this.mesas.cambiarEstado(item.id, p.estado);
        break;

      case SyncEntidad.MOVIMIENTO_INVENTARIO:
        await this.inventario.registrarMovimiento({
          sucursalId: item.sucursalId,
          insumoId: p.insumoId,
          tipo: p.tipo,
          cantidad: p.cantidad,
          motivo: p.motivo,
          usuarioId: item.usuarioId,
          dispositivoId: item.dispositivoId,
          idempotencyKey: item.idempotencyKey,
        });
        break;

      case SyncEntidad.TURNO:
        if (item.operacion === SyncOperacion.CREATE) {
          await this.caja.abrirTurno({ sucursalId: item.sucursalId, cajaId: p.cajaId, usuarioId: item.usuarioId ?? p.usuarioId, montoInicial: p.montoInicial });
        } else {
          await this.caja.cerrarTurno(p.turnoId, p.montoFinalDeclarado);
        }
        break;
    }
  }

  /** Cambios de la sucursal desde el cursor `since` (o todo el catálogo/estado activo si se omite). */
  async pull(sucursalId: string, since?: string): Promise<SyncPullResponse> {
    const cursor = since ? new Date(since) : new Date(0);
    const ahora = new Date();

    const [pedidos, mesas, productosSucursal, inventario] = await Promise.all([
      this.prisma.pedido.findMany({
        where: { sucursalId, updatedAt: { gt: cursor } },
        include: { items: { include: { modificadores: true } } },
        take: 500,
      }),
      this.prisma.mesa.findMany({ where: { sucursalId } }),
      this.prisma.productoSucursal.findMany({ where: { sucursalId } }),
      this.prisma.inventarioSucursal.findMany({ where: { sucursalId } }),
    ]);

    const cambios: SyncChange[] = [
      ...pedidos.map((p) => ({
        entidad: SyncEntidad.PEDIDO,
        operacion: SyncOperacion.UPDATE,
        id: p.id,
        payload: p,
        updatedAtServer: p.updatedAt.toISOString(),
      })),
      ...mesas.map((m) => ({
        entidad: SyncEntidad.MESA,
        operacion: SyncOperacion.UPDATE,
        id: m.id,
        payload: m,
        updatedAtServer: ahora.toISOString(),
      })),
      ...productosSucursal.map((ps) => ({
        entidad: SyncEntidad.PRODUCTO_SUCURSAL,
        operacion: SyncOperacion.UPDATE,
        id: ps.id,
        payload: ps,
        updatedAtServer: ahora.toISOString(),
      })),
      ...inventario.map((inv) => ({
        entidad: SyncEntidad.INVENTARIO_SUCURSAL,
        operacion: SyncOperacion.UPDATE,
        id: inv.id,
        payload: inv,
        updatedAtServer: ahora.toISOString(),
      })),
    ];

    return { cambios, cursor: ahora.toISOString() };
  }
}
