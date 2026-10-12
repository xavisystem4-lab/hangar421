import { InventarioService } from "./inventario.service";

/**
 * La tablet guarda el alta/edición de un insumo primero en su base y la manda por la cola cuando
 * hay red. El ERP tiene que aceptar el mismo sobre varias veces sin duplicar nada.
 */
function crear(existente: { empresaId: string } | null) {
  const prisma = {
    insumo: {
      findUnique: jest.fn(async () => existente),
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
  it("CREATE nuevo: lo crea con el id de la tablet y siembra mínimos en todas las sucursales", async () => {
    const { service, prisma } = crear(null);
    await service.aplicarInsumoDesdeTerminal({
      id: "ins-1", empresaId: "e1", sucursalId: "s1", operacion: "CREATE",
      datos: { nombre: "Lechuga spring mix", unidadMedida: "g", minimo: 500, presentacionNombre: "Bolsa", presentacionCantidad: 500 },
    });
    expect(prisma.insumo.create).toHaveBeenCalledWith({ data: expect.objectContaining({ id: "ins-1", empresaId: "e1", unidadMedida: "g", presentacionNombre: "Bolsa" }) });
    expect(prisma.inventarioSucursal.upsert).toHaveBeenCalledTimes(2);
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
