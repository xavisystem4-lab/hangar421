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
import { CatalogoService } from "../catalogo/catalogo.service";

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private prisma: PrismaService,
    private pedidos: PedidosService,
    private mesas: MesasService,
    private inventario: InventarioService,
    private caja: CajaService,
    private catalogo: CatalogoService,
  ) {}

  /** Aplica un lote de operaciones offline. Idempotente: reenviar el mismo lote
   *  (reintento de red) no duplica nada — se identifica por `idempotencyKey`. */
  async push(items: SyncEnvelope[]): Promise<{ resultados: SyncItemResult[]; serverTime: string }> {
    const resultados: SyncItemResult[] = [];

    for (const item of items) {
      resultados.push(await this.aplicarItem(item));
    }

    await this.marcarVisto(items[0]?.dispositivoId, items[0]?.sucursalId);

    return { resultados, serverTime: new Date().toISOString() };
  }

  /**
   * Marca la terminal como vista ahora (el CRM lo lee como "en línea / offline").
   *
   * El cliente manda su propia huella de instalación, que en el modelo es
   * `Dispositivo.identificador`, NO `Dispositivo.id`. Esto actualizaba por `id`, así que nunca
   * encontraba la fila y el `.catch()` se lo tragaba en silencio: el indicador de "en línea"
   * no se encendía jamás para ningún cliente. Se resuelve la huella igual que hace
   * `aplicarItem` antes de guardar un SyncQueueItem.
   */
  /**
   * Operaciones rechazadas por el ERP que siguen sin aplicarse.
   *
   * `SyncQueueItem` no tiene `empresaId` ni `sucursalId` propios: cuelga del dispositivo, así
   * que el acotamiento va por la sucursal del dispositivo. Es también lo que garantiza que un
   * usuario no vea los problemas de otra empresa.
   *
   * Se devuelve el `ultimoError` tal cual lo generó el backend: quien lee esto es un
   * administrador tratando de entender por qué falta una venta, y un mensaje genérico no le
   * serviría de nada. No lleva el `payload`, que puede contener datos del ticket completo.
   */
  async listarProblemas(empresaId: string, sucursalId?: string) {
    const items = await this.prisma.syncQueueItem.findMany({
      where: {
        estado: SyncStatus.ERROR,
        dispositivo: { sucursal: { empresaId, ...(sucursalId ? { id: sucursalId } : {}) } },
      },
      include: { dispositivo: { select: { nombre: true, tipo: true, sucursal: { select: { id: true, nombre: true } } } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return items.map((i) => ({
      id: i.id,
      entidad: i.entidad,
      entidadId: i.entidadId,
      operacion: i.operacion,
      intentos: i.intentos,
      ultimoError: i.ultimoError,
      createdAt: i.createdAt,
      terminal: i.dispositivo.nombre,
      tipoTerminal: i.dispositivo.tipo,
      sucursal: i.dispositivo.sucursal,
    }));
  }

  async marcarVisto(huella: string | undefined, sucursalId: string | undefined): Promise<void> {
    if (!huella) return;
    const dispositivoId = await resolverDispositivoId(this.prisma, huella, sucursalId);
    if (!dispositivoId) return;
    await this.prisma.dispositivo
      .update({ where: { id: dispositivoId }, data: { ultimaConexion: new Date() } })
      .catch(() => undefined);
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
            // Se perdía este campo al reconstruir el pedido desde la cola offline (outbox), así
            // que un pedido que se cae por corte de red y se reintenta luego por /sync/push
            // nacía en EstadoPedido.ABIERTO en vez de ENVIADO — invisible para siempre en "Por
            // cobrar" (que solo filtra ENVIADO/EN_PREPARACION/LISTO) porque ya no hay flujo de
            // cocina que lo transicione. `?? true`: todo PEDIDO/CREATE que llega por el outbox
            // de un mesero es una orden que el mesero ya dio por enviada.
            enviarInmediato: p.enviarInmediato ?? true,
          });
        } else if (item.operacion === SyncOperacion.UPDATE && p.accion === "CANCELAR") {
          // Cancelación hecha en una terminal, con el PIN del gerente ya validado allí (ver
          // PedidosService.cancelarDesdeTerminal). Llega por la cola como cualquier otra
          // operación, así que funciona igual si la tienda estaba sin red al cancelar.
          await this.pedidos.cancelarDesdeTerminal(p.pedidoId ?? item.id, {
            motivo: p.motivo ?? "Cancelada desde la terminal",
            autorizadoPorId: p.autorizadoPorId,
            autorizadoPorNombre: p.autorizadoPorNombre,
            solicitadoPorId: p.solicitadoPorId ?? item.usuarioId,
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
          password: p.password,
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
          // `desgloseEfectivo` se perdía al llegar por la cola offline: el POS Windows sí lo
          // manda en su POST directo, pero un corte hecho en el APK llegaba sin el conteo de
          // billetes y monedas, así que no había forma de auditarlo después.
          await this.caja.cerrarTurno(p.turnoId, p.montoFinalDeclarado, p.desgloseEfectivo);
        }
        break;

      // Ingreso/egreso individual dentro de un turno ya abierto (distinto de TURNO, que es
      // abrir/cerrar el turno completo) — usado por apps/pos-terminal (ver turnosRepo.ts).
      case SyncEntidad.MOVIMIENTO_CAJA:
        await this.caja.registrarMovimiento({
          turnoId: p.turnoId,
          tipo: p.tipo,
          monto: p.monto,
          motivo: p.motivo,
          usuarioId: item.usuarioId ?? p.usuarioId,
        });
        break;

      // Cambio de precio/disponibilidad por sucursal (no crea un Producto nuevo — eso sigue sin
      // ruta de sync, ver apps/pos-terminal/src/db/catalogoAdminRepo.ts). `p.precio` presente ⇒
      // vino de editar el precio; si no, es solo un toggle de disponibilidad.
      case SyncEntidad.PRODUCTO_SUCURSAL:
        if (p.precio != null) {
          await this.catalogo.fijarPrecioSucursal(p.productoId, item.sucursalId, p.precio, p.disponible ?? true);
        } else {
          await this.catalogo.fijarDisponibilidad(p.productoId, item.sucursalId, p.disponible);
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
