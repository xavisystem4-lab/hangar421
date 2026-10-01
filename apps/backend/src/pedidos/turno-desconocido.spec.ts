import { PedidosService } from "./pedidos.service";
import { CanalOrigen, TipoPedido } from "@hangar421/shared";

/**
 * Regresión: una venta del APK que traía el id de un turno que el ERP no conoce se rechazaba
 * entera con `Foreign key constraint violated: pedidos_turnoId_fkey` y se quedaba atascada en la
 * cola de la tablet (visto en la sucursal Benito Juárez). Ahora entra sin turno; el cobro lo
 * asigna después por cajero y hora.
 */
function crearServicio(turnosExistentes: string[]) {
  const creados: any[] = [];
  const tx = {
    pedido: { create: jest.fn((args: any) => { creados.push(args.data); return Promise.resolve({ ...args.data, items: [], mesa: null }); }) },
    mesa: { update: jest.fn() },
  };
  const prisma = {
    pedido: { findUnique: jest.fn(() => Promise.resolve(null)) },
    sucursal: { findUniqueOrThrow: jest.fn(() => Promise.resolve({ id: "suc-1", tasaImpuesto: 0 })) },
    usuario: { findUnique: jest.fn(() => Promise.resolve(null)) },
    turno: { findUnique: jest.fn(({ where: { id } }: any) => Promise.resolve(turnosExistentes.includes(id) ? { id } : null)) },
    $transaction: jest.fn((fn: any) => fn(tx)),
  };
  const realtime = { emitirASucursal: jest.fn(), emitirAEmpresa: jest.fn() };
  const service = new PedidosService(prisma as any, realtime as any, {} as any);
  (service as any).generarFolio = jest.fn(() => Promise.resolve("F-1"));
  (service as any).resolverItem = jest.fn((it: any) =>
    Promise.resolve({ productoId: it.productoId, cantidad: it.cantidad, precioUnitario: 50, modificadoresPrecio: 0, modificadoresSeleccionados: [] }),
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
  items: [{ productoId: "prod-1", cantidad: 2 }],
};

describe("PedidosService.crear — turno desconocido", () => {
  it("guarda la venta sin turno si el ERP no conoce el turno de la terminal", async () => {
    const { service, creados } = crearServicio([]);
    await service.crear({ ...DTO, turnoId: "turno-de-la-tablet" } as any);
    expect(creados[0].turnoId).toBeNull();
  });

  it("conserva el turno cuando sí existe en el ERP", async () => {
    const { service, creados } = crearServicio(["turno-1"]);
    await service.crear({ ...DTO, turnoId: "turno-1" } as any);
    expect(creados[0].turnoId).toBe("turno-1");
  });
});
