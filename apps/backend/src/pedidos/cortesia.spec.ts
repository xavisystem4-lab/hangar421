import { PedidosService } from "./pedidos.service";
import { CanalOrigen, TipoPedido } from "@hangar421/shared";

/** Cortesía autorizada en el APK: el pedido llega con lo que sí se cobra (extras) y el ERP guarda
 *  lo regalado como descuento MONTO, con quién lo autorizó. */
function crearServicio(usuarios: string[] = []) {
  const creados: any[] = [];
  const tx = {
    pedido: { create: jest.fn((args: any) => { creados.push(args.data); return Promise.resolve({ ...args.data, items: [], mesa: null }); }) },
    mesa: { update: jest.fn() },
  };
  const prisma = {
    pedido: { findUnique: jest.fn(() => Promise.resolve(null)) },
    sucursal: { findUniqueOrThrow: jest.fn(() => Promise.resolve({ id: "suc-1", tasaImpuesto: 0 })) },
    usuario: { findUnique: jest.fn(({ where: { id } }: any) => Promise.resolve(usuarios.includes(id) ? { id } : null)) },
    turno: { findUnique: jest.fn(() => Promise.resolve(null)) },
    $transaction: jest.fn((fn: any) => fn(tx)),
  };
  const service = new PedidosService(prisma as any, { emitirASucursal: jest.fn(), emitirAEmpresa: jest.fn() } as any, {} as any);
  (service as any).generarFolio = jest.fn(() => Promise.resolve("F-1"));
  // Latte $85 con un extra de $20 (leche de avena): subtotal $105.
  (service as any).resolverItem = jest.fn((it: any) =>
    Promise.resolve({ productoId: it.productoId, cantidad: it.cantidad, precioUnitario: 85, modificadoresPrecio: 20, modificadoresSeleccionados: [{ id: "op-avena", precioExtra: 20 }] }),
  );
  return { service, creados };
}

const DTO = {
  id: "venta-1",
  empresaId: "emp-1",
  sucursalId: "suc-1",
  tipo: TipoPedido.MOSTRADOR,
  canalOrigen: CanalOrigen.APP_POS_MOVIL,
  enviarInmediato: true,
  items: [{ productoId: "latte", cantidad: 1, modificadores: [{ opcionModificadorId: "op-avena" }] }],
};

describe("PedidosService.crear — cortesía de la terminal", () => {
  it("cobra solo los extras y guarda lo regalado como descuento con su autorizador", async () => {
    const { service, creados } = crearServicio(["gerente-1"]);
    await service.crear({ ...DTO, cortesia: { totalACobrar: 20, motivo: "Cortesía — cliente frecuente" }, cortesiaAutorizadaPorId: "gerente-1" } as any);

    expect(creados[0].subtotal).toBe(105);
    expect(creados[0].total).toBe(20);
    expect(creados[0].descuentoTotal).toBe(85);
    expect(creados[0].descuentos.create).toEqual([
      { tipo: "MONTO", valor: 85, montoAplicado: 85, motivo: "Cortesía — cliente frecuente", autorizadoPorId: "gerente-1" },
    ]);
  });

  it("regala todo (total 0) y tolera un autorizador que el ERP no conoce", async () => {
    const { service, creados } = crearServicio([]);
    await service.crear({ ...DTO, cortesia: { totalACobrar: 0 }, cortesiaAutorizadaPorId: "pin-local" } as any);

    expect(creados[0].total).toBe(0);
    expect(creados[0].descuentos.create[0]).toMatchObject({ montoAplicado: 105, motivo: "Cortesía", autorizadoPorId: null });
  });

  it("sin cortesía el pedido no lleva descuentos", async () => {
    const { service, creados } = crearServicio();
    await service.crear(DTO as any);
    expect(creados[0].total).toBe(105);
    expect(creados[0].descuentos).toBeUndefined();
  });
});
