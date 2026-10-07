import { InventarioService } from "./inventario.service";

/** Secciones del conteo físico: upsert desde la terminal y asignación de insumos, acotadas a la
 *  sucursal. Mocks simples, igual que caja.service.spec.ts. */
function crearServicio(secciones: Record<string, { sucursalId: string }> = {}) {
  const prisma = {
    seccionInventario: {
      upsert: jest.fn((args: any) => Promise.resolve({ id: args.where.id, ...args.create })),
      findUnique: jest.fn(({ where }: any) => Promise.resolve(secciones[where.id] ?? null)),
    },
    insumoSeccion: { upsert: jest.fn((args: any) => Promise.resolve(args.create)) },
  };
  return { service: new InventarioService(prisma as any, {} as any), prisma };
}

describe("InventarioService — secciones del conteo", () => {
  it("guarda una sección con su id y nombre limpio", async () => {
    const { service, prisma } = crearServicio();
    await service.guardarSeccion("suc-1", { id: "sec-1", nombre: "  Refrigerador 1 ", orden: 2 });
    expect(prisma.seccionInventario.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sec-1" },
        create: expect.objectContaining({ id: "sec-1", sucursalId: "suc-1", nombre: "Refrigerador 1", orden: 2, activo: true }),
      }),
    );
  });

  it("rechaza una sección sin nombre", async () => {
    const { service } = crearServicio();
    await expect(service.guardarSeccion("suc-1", { id: "sec-1", nombre: "  " })).rejects.toThrow(/nombre/);
  });

  it("asigna un insumo a una sección de su sucursal, o lo deja sin sección", async () => {
    const { service, prisma } = crearServicio({ "sec-1": { sucursalId: "suc-1" } });
    await service.asignarSeccion("suc-1", "ins-1", "sec-1");
    await service.asignarSeccion("suc-1", "ins-2", null);
    expect(prisma.insumoSeccion.upsert).toHaveBeenNthCalledWith(1, expect.objectContaining({ create: { insumoId: "ins-1", sucursalId: "suc-1", seccionId: "sec-1" } }));
    expect(prisma.insumoSeccion.upsert).toHaveBeenNthCalledWith(2, expect.objectContaining({ create: { insumoId: "ins-2", sucursalId: "suc-1", seccionId: null } }));
  });

  it("no deja asignar una sección de otra sucursal", async () => {
    const { service, prisma } = crearServicio({ "sec-x": { sucursalId: "otra" } });
    await expect(service.asignarSeccion("suc-1", "ins-1", "sec-x")).rejects.toThrow(/otra sucursal/);
    expect(prisma.insumoSeccion.upsert).not.toHaveBeenCalled();
  });
});
