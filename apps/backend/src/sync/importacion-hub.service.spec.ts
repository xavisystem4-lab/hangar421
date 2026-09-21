import { BadRequestException, ConflictException } from "@nestjs/common";
import type { VentaHub } from "@hangar421/shared";
import { ImportacionHubService, folioEnNube } from "./importacion-hub.service";

/** Prisma falso con lo que toca el importador. Se registran las escrituras para afirmar sobre lo
 *  que se guarda (totales, fecha y folio originales; nada de re-precio ni inventario). */
function crear(opciones: { existente?: { sucursalId: string } | null; productosDeLaEmpresa?: string[] } = {}) {
  const escrito: Record<string, any[]> = { pedidoCreate: [], pedidoUpdate: [], item: [], pagos: [], descuentos: [] };
  const tx = {
    pedido: { create: jest.fn(async (a: any) => escrito.pedidoCreate.push(a.data)), update: jest.fn(async (a: any) => escrito.pedidoUpdate.push(a.data)) },
    pedidoItem: { create: jest.fn(async (a: any) => escrito.item.push(a.data)) },
    pago: { createMany: jest.fn(async (a: any) => escrito.pagos.push(a)) },
    descuento: { createMany: jest.fn(async (a: any) => escrito.descuentos.push(a)) },
  };
  const prisma: any = {
    producto: { findMany: jest.fn(async ({ where }: any) => where.id.in.filter((id: string) => (opciones.productosDeLaEmpresa ?? ["n-latte"]).includes(id)).map((id: string) => ({ id }))) },
    opcionModificador: { findMany: jest.fn(async () => [{ id: "n-avena" }]) },
    usuario: { findUnique: jest.fn(async ({ where }: any) => (where.id === "n-ana" ? { empresaId: "emp-1" } : where.id === "ajeno" ? { empresaId: "emp-2" } : null)) },
    dispositivo: { findUnique: jest.fn(async () => ({ id: "disp-pc" })), create: jest.fn() },
    pedido: { findUnique: jest.fn(async () => opciones.existente ?? null) },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  const realtime: any = { emitirAEmpresa: jest.fn() };
  return { servicio: new ImportacionHubService(prisma, realtime), escrito, realtime };
}

const VENTA: VentaHub = {
  folioLocal: "20260921-0007", estado: "COBRADO", creadaEn: "2026-09-21T15:00:00.000Z", tipo: "MOSTRADOR", canalOrigen: "POS_WINDOWS",
  numComensales: 1, subtotal: 100, impuesto: 16, descuentoTotal: 0, total: 116, meseroId: "n-ana", cajeroId: "ajeno",
  items: [{ id: "i-1", productoId: "n-latte", cantidad: 2, precioUnitario: 50, modificadores: [{ id: "m-1", opcionModificadorId: "n-avena", precioExtra: 8 }, { id: "m-2", opcionModificadorId: "n-otra", precioExtra: 0 }] }],
  pagos: [{ id: "p-1", metodo: "EFECTIVO", monto: 116 }],
  descuentos: [],
};
const PARAMS = { id: "v-1", empresaId: "emp-1", sucursalId: "suc-1", huellaHub: "pc-1234-abcd", venta: VENTA };

describe("ImportacionHubService.importarVenta", () => {
  it("guarda la venta tal como se cobró: totales, fecha y folio del POS", async () => {
    const { servicio, escrito } = crear();
    await servicio.importarVenta(PARAMS);
    expect(escrito.pedidoCreate[0]).toMatchObject({
      id: "v-1", folio: "PCABCD-20260921-0007", total: 116, subtotal: 100, impuesto: 16,
      createdAt: new Date("2026-09-21T15:00:00.000Z"), canalOrigen: "POS_WINDOWS", estado: "COBRADO",
    });
    expect(escrito.item[0]).toMatchObject({ productoId: "n-latte", precioUnitario: 50, cantidad: 2 });
    expect(escrito.pagos[0]).toMatchObject({ skipDuplicates: true });
  });

  it("omite una opción de modificador que no es de la empresa (el importe ya va en el total)", async () => {
    const { servicio, escrito } = crear();
    await servicio.importarVenta(PARAMS);
    expect(escrito.item[0].modificadores.create).toEqual([{ id: "m-1", opcionModificadorId: "n-avena", precioExtra: 8 }]);
  });

  it("no atribuye la venta a un usuario de otra empresa", async () => {
    const { servicio, escrito } = crear();
    await servicio.importarVenta(PARAMS);
    expect(escrito.pedidoCreate[0]).toMatchObject({ meseroId: "n-ana", cajeroId: null });
  });

  it("rechaza un producto que no es del catálogo de la nube de esa empresa", async () => {
    const { servicio } = crear({ productosDeLaEmpresa: [] });
    await expect(servicio.importarVenta(PARAMS)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("una versión posterior (cancelada) actualiza estado y totales sin crear otra venta", async () => {
    const { servicio, escrito } = crear({ existente: { sucursalId: "suc-1" } });
    await servicio.importarVenta({ ...PARAMS, venta: { ...VENTA, estado: "CANCELADO" } });
    expect(escrito.pedidoCreate).toHaveLength(0);
    expect(escrito.pedidoUpdate[0]).toMatchObject({ estado: "CANCELADO", total: 116 });
  });

  it("no toca una venta con ese id de otra sucursal", async () => {
    const { servicio } = crear({ existente: { sucursalId: "otra" } });
    await expect(servicio.importarVenta(PARAMS)).rejects.toBeInstanceOf(ConflictException);
  });

  it("solo importa ventas cerradas", async () => {
    const { servicio } = crear();
    await expect(servicio.importarVenta({ ...PARAMS, venta: { ...VENTA, estado: "ABIERTO" as any } })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("el folio lleva el prefijo del POS para no chocar con otros equipos de la sucursal", () => {
    expect(folioEnNube("pc-9f1e-77aa", "20260921-0001")).toBe("PC77AA-20260921-0001");
  });
});
