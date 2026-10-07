import { PedidosService } from "./pedidos.service";
import { EstadoPedido, MetodoPago } from "@hangar421/shared";

/** Crédito de empleado: al cobrar con MONEDERO_EMPLEADO el consumo queda en el monedero de la
 *  empleada (un movimiento por venta, con el id del pedido), y cancelar la venta lo devuelve. */
function crearServicio(monederos: string[] = ["emp-diana"]) {
  const pedido = { id: "pedido-1", sucursalId: "suc-1", empresaId: "emp-1", mesaId: null, turnoId: "turno-1", total: 180, estado: EstadoPedido.ENVIADO, items: [], descuentos: [] };
  const tx = {
    pago: { createMany: jest.fn((_args: any) => Promise.resolve({})) },
    pedido: { update: jest.fn(() => Promise.resolve({})) },
    pedidoItem: { updateMany: jest.fn((_args: any) => Promise.resolve({})) },
    mesa: { update: jest.fn() },
    monederoEmpleado: { findUnique: jest.fn(({ where: { usuarioId } }: any) => Promise.resolve(monederos.includes(usuarioId) ? { usuarioId } : null)) },
    movimientoMonedero: { upsert: jest.fn((_args: any) => Promise.resolve({})), deleteMany: jest.fn((_args: any) => Promise.resolve({ count: 1 })) },
    auditLog: { create: jest.fn() },
  };
  const prisma = {
    pedido: { findUnique: jest.fn(() => Promise.resolve({ ...pedido, pagos: [], mesero: null, cajero: null, mesa: null })) },
    usuario: { findUnique: jest.fn(() => Promise.resolve({ id: "cajero-1" })) },
    $transaction: jest.fn((fn: any) => fn(tx)),
  };
  const service = new PedidosService(prisma as any, { emitirASucursal: jest.fn(), emitirAEmpresa: jest.fn() } as any, {} as any);
  (service as any).descontarInventarioPorReceta = jest.fn(() => Promise.resolve());
  (service as any).reponerInventarioPorReceta = jest.fn(() => Promise.resolve());
  return { service, tx };
}

describe("PedidosService.cobrar — crédito de empleado", () => {
  it("registra el consumo en el monedero con el id del pedido y la hora del cobro", async () => {
    const { service, tx } = crearServicio();
    const cobradoEn = new Date("2026-10-07T20:00:00Z");
    await service.cobrar("pedido-1", { cajeroId: "cajero-1", pagos: [{ metodo: MetodoPago.MONEDERO_EMPLEADO, monto: 180, referencia: "Crédito empleado: Diana", empleadoId: "emp-diana" }] }, cobradoEn);

    expect(tx.movimientoMonedero.upsert).toHaveBeenCalledWith({
      where: { pedidoId: "pedido-1" },
      create: { id: "pedido-1", usuarioId: "emp-diana", sucursalId: "suc-1", pedidoId: "pedido-1", monto: 180, createdAt: cobradoEn },
      update: {},
    });
  });

  it("pago mixto: solo la parte del monedero va al monedero; el resto es otro pago normal", async () => {
    const { service, tx } = crearServicio();
    await service.cobrar("pedido-1", {
      cajeroId: "cajero-1",
      pagos: [
        { metodo: MetodoPago.MONEDERO_EMPLEADO, monto: 100, empleadoId: "emp-diana" },
        { metodo: MetodoPago.EFECTIVO, monto: 80 },
      ],
    });

    expect(tx.movimientoMonedero.upsert.mock.calls[0][0].create.monto).toBe(100);
    expect(tx.pago.createMany.mock.calls[0][0].data).toHaveLength(2);
  });

  it("no toca el monedero cuando no se pagó con crédito", async () => {
    const { service, tx } = crearServicio();
    await service.cobrar("pedido-1", { cajeroId: "cajero-1", pagos: [{ metodo: MetodoPago.EFECTIVO, monto: 180 }] });
    expect(tx.movimientoMonedero.upsert).not.toHaveBeenCalled();
  });

  it("si la empleada no tiene monedero, el cobro NO se rechaza (se prefiere no perder la venta)", async () => {
    const { service, tx } = crearServicio([]);
    await service.cobrar("pedido-1", { cajeroId: "cajero-1", pagos: [{ metodo: MetodoPago.MONEDERO_EMPLEADO, monto: 180, empleadoId: "desconocida" }] });

    expect(tx.pago.createMany).toHaveBeenCalled();
    expect(tx.pedido.update).toHaveBeenCalled();
    expect(tx.movimientoMonedero.upsert).not.toHaveBeenCalled();
  });
});

describe("PedidosService.cancelarDesdeTerminal — crédito de empleado", () => {
  it("al cancelar una venta pagada con crédito se borra su consumo (el saldo vuelve a la empleada)", async () => {
    const { service, tx } = crearServicio();
    (service as any).obtener = jest.fn(() => Promise.resolve({ id: "pedido-1", sucursalId: "suc-1", empresaId: "emp-1", mesaId: null, estado: EstadoPedido.COBRADO, total: 180 }));
    await service.cancelarDesdeTerminal("pedido-1", { motivo: "error de captura", autorizadoPorId: "gerente-1" });

    expect(tx.movimientoMonedero.deleteMany).toHaveBeenCalledWith({ where: { pedidoId: "pedido-1" } });
  });
});
