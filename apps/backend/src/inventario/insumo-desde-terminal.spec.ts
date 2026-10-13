import { InventarioService } from "./inventario.service";

/**
 * La tablet guarda el alta/edición de un insumo primero en su base y la manda por la cola cuando
 * hay red. El ERP tiene que aceptar el mismo sobre varias veces sin duplicar nada.
 */
function crear(existente: { empresaId: string } | null, mismos: any[] = []) {
  const prisma = {
    insumo: {
      findUnique: jest.fn(async () => existente),
      findMany: jest.fn(async () => mismos),
      create: jest.fn(async ({ data }: any) => ({ ...data })),
      update: jest.fn(async () => ({})),
    },
    sucursal: { findMany: jest.fn(async () => [{ id: "s1" }, { id: "s2" }]) },
    inventarioSucursal: { upsert: jest.fn(async () => ({})) },
    $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
  };
  return { service: new InventarioService(prisma as any, {} as any, {} as any), prisma };
}

describe("aplicarInsumoDesdeTerminal", () => {
  it("CREATE nuevo: lo crea con el id de la tablet SOLO en la sucursal de la tablet", async () => {
    const { service, prisma } = crear(null);
    await service.aplicarInsumoDesdeTerminal({
      id: "ins-1", empresaId: "e1", sucursalId: "s1", operacion: "CREATE",
      datos: { nombre: "Lechuga spring mix", unidadMedida: "g", minimo: 500, presentacionNombre: "Bolsa", presentacionCantidad: 500 },
    });
    expect(prisma.insumo.create).toHaveBeenCalledWith({ data: expect.objectContaining({ id: "ins-1", empresaId: "e1", unidadMedida: "g", presentacionNombre: "Bolsa" }) });
    expect(prisma.inventarioSucursal.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.inventarioSucursal.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { sucursalId_insumoId: { sucursalId: "s1", insumoId: "ins-1" } } }));
  });

  it("CREATE reenviado (ya existe): no duplica, actualiza", async () => {
    const { service, prisma } = crear({ empresaId: "e1" });
    await service.aplicarInsumoDesdeTerminal({ id: "ins-1", empresaId: "e1", sucursalId: "s1", operacion: "CREATE", datos: { nombre: "Lechuga", unidadMedida: "g" } });
    expect(prisma.insumo.create).not.toHaveBeenCalled();
    expect(prisma.insumo.update).toHaveBeenCalled();
  });

  it("UPDATE: solo lo que cambió, y los mínimos para la sucursal de la tablet", async () => {
    const { service, prisma } = crear({ empresaId: "e1" });
    await service.aplicarInsumoDesdeTerminal({ id: "ins-1", empresaId: "e1", sucursalId: "s2", operacion: "UPDATE", datos: { costoUnitario: 0.2, minimo: 300 } });
    expect(prisma.insumo.update).toHaveBeenCalledWith({ where: { id: "ins-1" }, data: { costoUnitario: 0.2 } });
    expect(prisma.inventarioSucursal.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { sucursalId_insumoId: { sucursalId: "s2", insumoId: "ins-1" } } }));
  });

  it("rechaza tocar un insumo de otra empresa", async () => {
    const { service } = crear({ empresaId: "otra" });
    await expect(service.aplicarInsumoDesdeTerminal({ id: "ins-1", empresaId: "e1", sucursalId: "s1", operacion: "UPDATE", datos: { nombre: "x" } })).rejects.toThrow("otra empresa");
  });
});

describe("insumos por sucursal", () => {
  it("dar de alta en el ERP con sucursal elegida: solo esa sucursal lo maneja", async () => {
    const { service, prisma } = crear(null);
    await service.crearInsumo({ empresaId: "e1", nombre: "Leche de soya", unidadMedida: "ml", sucursalId: "mec", minimo: 1000 });
    expect(prisma.sucursal.findMany).not.toHaveBeenCalled();
    expect(prisma.inventarioSucursal.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.inventarioSucursal.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { sucursalId_insumoId: { sucursalId: "mec", insumoId: undefined } } }));
  });

  it("si ya existe con ese nombre en la empresa, no lo duplica: lo agrega a esta sucursal", async () => {
    const { service, prisma } = crear(null, [{ id: "soya", nombre: "Leche  de Soya", activo: true }]);
    const r = await service.crearInsumo({ empresaId: "e1", nombre: "leche de soya", unidadMedida: "ml", sucursalId: "bj" });
    expect(r).toMatchObject({ id: "soya" });
    expect(prisma.insumo.create).not.toHaveBeenCalled();
    expect(prisma.inventarioSucursal.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { sucursalId_insumoId: { sucursalId: "bj", insumoId: "soya" } } }));
  });

  it("listar con sucursal filtra por los que maneja (o sin sucursal, o preparaciones)", async () => {
    const { service, prisma } = crear(null);
    await service.listarInsumos("e1", "bj");
    expect(prisma.insumo.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ OR: [{ inventario: { some: { sucursalId: "bj" } } }, { inventario: { none: {} } }, { esPreparacion: true }] }),
    }));
  });
});
