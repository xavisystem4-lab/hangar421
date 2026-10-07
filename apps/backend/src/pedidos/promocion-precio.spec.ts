import { PedidosService } from "./pedidos.service";

/** El servidor NO confía en el precio que manda la tablet: recalcula el precio especial con la
 *  definición de la promoción, y solo si aplica al producto y es de la misma empresa. */
function crearServicio(promocion: any) {
  const prisma = {
    producto: { findUnique: jest.fn(() => Promise.resolve({ id: "latte", empresaId: "emp-1", nombre: "Latte", precioBase: 85 })) },
    opcionModificador: { findMany: jest.fn(() => Promise.resolve([])) },
    promocion: { findUnique: jest.fn(() => Promise.resolve(promocion)) },
  };
  return { service: new PedidosService(prisma as any, {} as any, {} as any), prisma };
}
const resolver = (service: PedidosService, item: any) => (service as any).resolverItem({ productoId: "latte", cantidad: 1, ...item });
const PROMO = { id: "pr-1", empresaId: "emp-1", tipo: "PRECIO", valor: 49, productos: [{ productoId: "latte" }] };

describe("PedidosService.resolverItem — promociones", () => {
  it("precio directo", async () => {
    const r = await resolver(crearServicio(PROMO).service, { promocionId: "pr-1" });
    expect(r).toMatchObject({ precioUnitario: 49, promocionId: "pr-1" });
  });

  it("porcentaje sobre el precio del ERP, no sobre el que mande la tablet", async () => {
    const r = await resolver(crearServicio({ ...PROMO, tipo: "PORCENTAJE", valor: 20 }).service, { promocionId: "pr-1", precioUnitario: 1 });
    expect(r).toMatchObject({ precioUnitario: 68, promocionId: "pr-1" });
  });

  it("sin promoción cobra el precio de catálogo", async () => {
    const r = await resolver(crearServicio(PROMO).service, {});
    expect(r).toMatchObject({ precioUnitario: 85 });
    expect(r.promocionId).toBeUndefined();
  });

  it.each([
    ["no existe", null],
    ["es de otra empresa", { ...PROMO, empresaId: "emp-2" }],
    ["no incluye el producto", { ...PROMO, productos: [] }],
    ["no baja el precio", { ...PROMO, valor: 90 }],
  ])("si la promoción %s, cobra el precio de catálogo", async (_caso: string, promo: any) => {
    const r = await resolver(crearServicio(promo).service, { promocionId: "pr-1" });
    expect(r).toMatchObject({ precioUnitario: 85 });
    expect(r.promocionId).toBeUndefined();
  });
});
