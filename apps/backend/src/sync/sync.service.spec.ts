import { SyncEntidad, SyncOperacion, SyncStatus } from "@hangar421/shared";
import { SyncService } from "./sync.service";

/** Pruebas de la cola de sincronización: idempotencia (no reprocesar un idempotencyKey ya
 *  aplicado) y manejo de errores por item sin tumbar el resto del lote. Se usan mocks simples
 *  en vez de un TestingModule de Nest porque SyncService no depende de nada específico de
 *  Nest en su lógica — solo de las inyecciones del constructor. */
function crearServicio() {
  const registros = new Map<string, any>();

  const prisma = {
    syncQueueItem: {
      findUnique: jest.fn(({ where: { idempotencyKey } }: any) => Promise.resolve(registros.get(idempotencyKey) ?? null)),
      upsert: jest.fn(({ where: { idempotencyKey }, create, update }: any) => {
        const existente = registros.get(idempotencyKey);
        const nuevo = existente ? { ...existente, ...update, intentos: (existente.intentos ?? 0) + 1 } : create;
        registros.set(idempotencyKey, nuevo);
        return Promise.resolve(nuevo);
      }),
    },
    dispositivo: { update: jest.fn(() => Promise.resolve({})) },
  };

  const pedidos = { crear: jest.fn(() => Promise.resolve({ id: "pedido-1" })) };
  const mesas = { cambiarEstado: jest.fn() };
  const inventario = { registrarMovimiento: jest.fn() };
  const caja = { abrirTurno: jest.fn(), cerrarTurno: jest.fn() };

  const service = new SyncService(prisma as any, pedidos as any, mesas as any, inventario as any, caja as any);
  return { service, prisma, pedidos, mesas, inventario, caja, registros };
}

function envolverPedido(idempotencyKey: string) {
  return {
    id: "pedido-1",
    entidad: SyncEntidad.PEDIDO,
    operacion: SyncOperacion.CREATE,
    idempotencyKey,
    dispositivoId: "dev-1",
    sucursalId: "suc-1",
    usuarioId: "user-1",
    createdAtLocal: new Date().toISOString(),
    payload: { empresaId: "emp-1", tipo: "MOSTRADOR", items: [{ productoId: "p1", cantidad: 1 }] },
  };
}

describe("SyncService.push — idempotencia", () => {
  it("aplica un item nuevo y lo marca SYNCED", async () => {
    const { service, pedidos } = crearServicio();
    const resp = await service.push([envolverPedido("dev-1-PEDIDO-1") as any]);

    expect(pedidos.crear).toHaveBeenCalledTimes(1);
    expect(resp.resultados[0].estado).toBe(SyncStatus.SYNCED);
  });

  it("no vuelve a aplicar un idempotencyKey ya sincronizado (reintento de red)", async () => {
    const { service, pedidos } = crearServicio();
    const envelope = envolverPedido("dev-1-PEDIDO-2");

    await service.push([envelope as any]);
    await service.push([envelope as any]); // simula el mismo lote reenviado tras un timeout

    expect(pedidos.crear).toHaveBeenCalledTimes(1);
  });

  it("un item con error no impide sincronizar el resto del lote", async () => {
    const { service, pedidos } = crearServicio();
    pedidos.crear
      .mockRejectedValueOnce(new Error("sucursal inexistente"))
      .mockResolvedValueOnce({ id: "pedido-2" });

    const resp = await service.push([
      envolverPedido("dev-1-PEDIDO-ERR") as any,
      envolverPedido("dev-1-PEDIDO-OK") as any,
    ]);

    expect(resp.resultados[0].estado).toBe(SyncStatus.ERROR);
    expect(resp.resultados[0].error).toContain("sucursal inexistente");
    expect(resp.resultados[1].estado).toBe(SyncStatus.SYNCED);
  });

  it("un item marcado ERROR sí se reintenta en el siguiente push (a diferencia de uno SYNCED)", async () => {
    const { service, pedidos } = crearServicio();
    const envelope = envolverPedido("dev-1-PEDIDO-RETRY");
    pedidos.crear.mockRejectedValueOnce(new Error("timeout de red"));

    await service.push([envelope as any]);
    expect(pedidos.crear).toHaveBeenCalledTimes(1);

    pedidos.crear.mockResolvedValueOnce({ id: "pedido-3" });
    const segundo = await service.push([envelope as any]);

    expect(pedidos.crear).toHaveBeenCalledTimes(2);
    expect(segundo.resultados[0].estado).toBe(SyncStatus.SYNCED);
  });
});
