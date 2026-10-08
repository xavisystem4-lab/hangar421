import { PedidosService } from "./pedidos.service";
import { EstadoPedido, MetodoPago } from "@hangar421/shared";

/**
 * Regresión: "El pago (175) no cubre el total del pedido (180); faltan 5".
 *
 * La tablet vende con el precio de SU sucursal (`productos_sucursal`), pero el ERP valuaba cada
 * línea con el precio base del producto. Si la sucursal tenía el producto más barato, el total
 * del ERP salía más alto que lo cobrado y el pago se rechazaba para siempre en la cola.
 */
describe("PedidosService — precio de la sucursal", () => {
  function servicioResolver(precioSucursal: number | null) {
    const prisma = {
      producto: { findUnique: jest.fn(() => Promise.resolve({ id: "latte", empresaId: "emp-1", nombre: "Latte", precioBase: 90 })) },
      productoSucursal: { findUnique: jest.fn(() => Promise.resolve(precioSucursal == null ? null : { precio: precioSucursal })) },
      opcionModificador: { findMany: jest.fn(() => Promise.resolve([])) },
      promocion: { findUnique: jest.fn(() => Promise.resolve(null)) },
    };
    return { service: new PedidosService(prisma as any, {} as any, {} as any), prisma };
  }
  const resolver = (service: PedidosService, sucursalId?: string) =>
    (service as any).resolverItem({ productoId: "latte", cantidad: 1 }, sucursalId);

  it("usa el precio propio de la sucursal cuando existe", async () => {
    const { service, prisma } = servicioResolver(85);
    await expect(resolver(service, "suc-mecanicos")).resolves.toMatchObject({ precioUnitario: 85 });
    expect(prisma.productoSucursal.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { productoId_sucursalId: { productoId: "latte", sucursalId: "suc-mecanicos" } } }),
    );
  });

  it("sin precio de sucursal usa el precio base", async () => {
    const { service } = servicioResolver(null);
    await expect(resolver(service, "suc-mecanicos")).resolves.toMatchObject({ precioUnitario: 90 });
  });

  it("cobrar repara un pedido ya creado con el precio base: lo revalúa y acepta el pago", async () => {
    let total = 180;
    const lineas = [{ id: "it-1", precioUnitario: 90, promocionId: null, producto: { id: "latte", precioBase: 90 } }];
    const tx = {
      pago: { createMany: jest.fn(() => Promise.resolve({})) },
      pedido: { update: jest.fn(() => Promise.resolve({})) },
      mesa: { update: jest.fn(() => Promise.resolve({})) },
    };
    const prisma: any = {
      pedido: {
        findUnique: jest.fn(() => Promise.resolve({
          id: "pedido-16", sucursalId: "suc-mecanicos", empresaId: "emp-1", mesaId: null, turnoId: "t-1",
          total, estado: EstadoPedido.ENVIADO, items: [], descuentos: [], pagos: [], mesero: null, cajero: null, mesa: null,
        })),
        findUniqueOrThrow: jest.fn(() => Promise.resolve({ total })),
      },
      pedidoItem: {
        findMany: jest.fn(() => Promise.resolve(lineas)),
        update: jest.fn(({ data }: any) => { lineas[0].precioUnitario = data.precioUnitario; return Promise.resolve({}); }),
      },
      productoSucursal: { findUnique: jest.fn(() => Promise.resolve({ precio: 87.5 })) },
      usuario: { findUnique: jest.fn(() => Promise.resolve(null)) },
      turno: { findFirst: jest.fn(() => Promise.resolve(null)) },
      $transaction: jest.fn((fn: any) => fn(tx)),
    };
    const service = new PedidosService(prisma, { emitirASucursal: jest.fn(), emitirAEmpresa: jest.fn() } as any, {} as any);
    (service as any).descontarInventarioPorReceta = jest.fn(() => Promise.resolve());
    // recalcularTotales real necesita la sucursal y sus impuestos; aquí basta con su efecto.
    (service as any).recalcularTotales = jest.fn(() => { total = lineas[0].precioUnitario * 2; return Promise.resolve(); });

    await expect(service.cobrar("pedido-16", { pagos: [{ metodo: MetodoPago.EFECTIVO, monto: 175 }] } as any)).resolves.toBeDefined();
    expect(prisma.pedidoItem.update).toHaveBeenCalledWith({ where: { id: "it-1" }, data: { precioUnitario: 87.5 } });
    expect(tx.pago.createMany).toHaveBeenCalled();
  });
});
