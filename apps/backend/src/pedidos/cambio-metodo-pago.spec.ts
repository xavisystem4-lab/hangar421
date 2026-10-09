import { PedidosService } from "./pedidos.service";
import { EstadoPedido, MetodoPago } from "@hangar421/shared";

/** Cambio de método de pago de una venta cobrada, hecho en la terminal (SyncEntidad.PAGO /
 *  UPDATE, accion CAMBIAR_METODO): reemplaza los pagos sin tocar el pedido; rechaza ventas no
 *  cobradas, pagos cortos y cualquier lado con crédito de empleado. */
function crearServicio(pedido: Partial<{ estado: EstadoPedido; total: number; pagos: any[] }> = {}) {
  const base = { id: "pedido-1", sucursalId: "suc-1", empresaId: "emp-1", mesaId: null, turnoId: "turno-1", total: 250, estado: EstadoPedido.COBRADO, items: [], descuentos: [], pagos: [{ metodo: MetodoPago.EFECTIVO, monto: 250 }], ...pedido };
  const tx = {
    pago: { deleteMany: jest.fn((_a: any) => Promise.resolve({ count: 1 })), createMany: jest.fn((_a: any) => Promise.resolve({})) },
  };
  const prisma = {
    pedido: { findUnique: jest.fn(() => Promise.resolve({ ...base, mesero: null, cajero: null, mesa: null })) },
    usuario: { findUnique: jest.fn(({ where: { id } }: any) => Promise.resolve(id === "cajero-1" ? { id } : null)) },
    $transaction: jest.fn((fn: any) => fn(tx)),
  };
  const realtime = { emitirASucursal: jest.fn(), emitirAEmpresa: jest.fn() };
  const service = new PedidosService(prisma as any, realtime as any, {} as any);
  return { service, tx, realtime };
}

describe("PedidosService.cambiarPagosDesdeTerminal", () => {
  it("reemplaza los pagos de la venta por los nuevos y avisa en tiempo real", async () => {
    const { service, tx, realtime } = crearServicio();
    await service.cambiarPagosDesdeTerminal("pedido-1", {
      pagos: [{ metodo: MetodoPago.TARJETA, monto: 250, referencia: "1234" }],
      cajeroId: "cajero-1",
      autorizadoPorId: "sup-1",
      autorizadoPorNombre: "Sofía",
    });

    expect(tx.pago.deleteMany).toHaveBeenCalledWith({ where: { pedidoId: "pedido-1" } });
    expect(tx.pago.createMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ pedidoId: "pedido-1", metodo: MetodoPago.TARJETA, monto: 250, referencia: "1234", usuarioId: "cajero-1", montoUsd: null, tipoCambio: null }),
    ]);
    expect(realtime.emitirASucursal).toHaveBeenCalled();
  });

  it("un cajero que el ERP no conoce no impide el cambio (queda sin atribución)", async () => {
    const { service, tx } = crearServicio();
    await service.cambiarPagosDesdeTerminal("pedido-1", { pagos: [{ metodo: MetodoPago.TRANSFERENCIA, monto: 250 }], cajeroId: "uuid-de-la-tablet" });
    expect(tx.pago.createMany.mock.calls[0][0].data[0].usuarioId).toBeUndefined();
  });

  it("rechaza una venta que no está cobrada, pagos que no cubren el total y crédito de empleado", async () => {
    const abierta = crearServicio({ estado: EstadoPedido.ENVIADO });
    await expect(abierta.service.cambiarPagosDesdeTerminal("pedido-1", { pagos: [{ metodo: MetodoPago.TARJETA, monto: 250 }] })).rejects.toThrow("cobrada");

    const corta = crearServicio();
    await expect(corta.service.cambiarPagosDesdeTerminal("pedido-1", { pagos: [{ metodo: MetodoPago.TARJETA, monto: 200 }] })).rejects.toThrow("no cubren");

    const haciaMonedero = crearServicio();
    await expect(haciaMonedero.service.cambiarPagosDesdeTerminal("pedido-1", { pagos: [{ metodo: MetodoPago.MONEDERO_EMPLEADO, monto: 250, empleadoId: "e" }] })).rejects.toThrow("crédito de empleado");

    const desdeMonedero = crearServicio({ pagos: [{ metodo: MetodoPago.MONEDERO_EMPLEADO, monto: 250 }] });
    await expect(desdeMonedero.service.cambiarPagosDesdeTerminal("pedido-1", { pagos: [{ metodo: MetodoPago.EFECTIVO, monto: 250 }] })).rejects.toThrow("crédito de empleado");

    expect(corta.tx.pago.deleteMany).not.toHaveBeenCalled();
  });
});
