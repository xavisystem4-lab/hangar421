import { TipoMovimientoInventario } from "@hangar421/shared";
import { ComprasService } from "./compras.service";

function crear() {
  const compras: any[] = [];
  const insumoUpdate = jest.fn(async () => ({}));
  const prisma: any = {
    insumo: {
      findUnique: jest.fn(async () => ({ id: "leche", empresaId: "e1", nombre: "Leche entera", unidadMedida: "ml", esPreparacion: false })),
      update: insumoUpdate,
    },
    sucursal: {
      findUnique: jest.fn(async () => ({ id: "s1", empresaId: "e1", nombre: "Mecánicos", timezone: "America/Tijuana" })),
      findFirst: jest.fn(async () => ({ timezone: "America/Tijuana" })),
    },
    proveedor: { findUnique: jest.fn(async () => ({ empresaId: "e1", nombre: "Lala" })) },
    usuario: { findUnique: jest.fn(async () => ({ nombre: "Marisa" })) },
    movimientoInventario: { update: jest.fn(async () => ({})) },
    compraInsumo: {
      findUnique: jest.fn(async ({ where }: any) => {
        const c = compras.find((x) => (where.id ? x.id === where.id : x.idempotencyKey === where.idempotencyKey));
        return c ? { ...c, insumo: { nombre: "Leche entera", unidadMedida: "ml" }, proveedor: c.proveedorId ? { nombre: "Lala" } : null, sucursal: { nombre: "Mecánicos" } } : null;
      }),
      findFirst: jest.fn(async () => {
        const v = compras.filter((c) => c.estado === "VIGENTE").sort((a, b) => b.fechaCompra - a.fechaCompra)[0];
        return v ? { costoUnitario: v.costoUnitario } : null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const c = { id: `c${compras.length + 1}`, estado: "VIGENTE", createdAt: new Date(), ...data };
        compras.push(c);
        return c;
      }),
      update: jest.fn(async ({ where, data }: any) => Object.assign(compras.find((c) => c.id === where.id), data)),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const c = compras.find((x) => x.id === where.id && x.estado === where.estado);
        if (c) Object.assign(c, data);
        return { count: c ? 1 : 0 };
      }),
      delete: jest.fn(async () => ({})),
    },
  };
  const movimientos: any[] = [];
  const inventario: any = {
    registrarMovimiento: jest.fn(async (d: any) => {
      const m = { id: `m${movimientos.length + 1}`, ...d };
      movimientos.push(m);
      return m;
    }),
  };
  return { service: new ComprasService(prisma, inventario), prisma, inventario, compras, movimientos, insumoUpdate };
}

describe("ComprasService", () => {
  it("registra la compra, mete la ENTRADA en unidad base y fija el costo vigente", async () => {
    const { service, movimientos, insumoUpdate, compras } = crear();
    const r = await service.registrar("e1", "u-marisa", {
      sucursalId: "s1", insumoId: "leche", proveedorId: "p1", unidadCaptura: "litro", cantidadCaptura: 20, factor: 1000, precioCaptura: 20,
      fechaCompra: "2026-11-10T18:00:00Z", idempotencyKey: "k1",
    });
    expect(r).toMatchObject({ total: 400, cantidadBase: 20000, costoUnitarioBase: 0.02, usuario: "Marisa", proveedor: "Lala", estado: "VIGENTE" });
    expect(movimientos).toHaveLength(1);
    expect(movimientos[0]).toMatchObject({ tipo: TipoMovimientoInventario.ENTRADA, cantidad: 20000, usuarioId: "u-marisa", idempotencyKey: "compra:c1" });
    expect(movimientos[0].motivo).toContain("Compra · Lala");
    expect(compras[0].movimientoId).toBe("m1");
    expect(insumoUpdate).toHaveBeenCalledWith({ where: { id: "leche" }, data: { costoUnitario: 0.02 } });
  });

  it("no duplica si se reenvía la misma compra", async () => {
    const { service, movimientos, compras } = crear();
    const datos = { sucursalId: "s1", insumoId: "leche", cantidadCaptura: 2, precioCaptura: 10, idempotencyKey: "k2" };
    await service.registrar("e1", "u1", datos);
    await service.registrar("e1", "u1", datos);
    expect(compras).toHaveLength(1);
    expect(movimientos).toHaveLength(1);
  });

  it("la compra anterior conserva su precio aunque la nueva cueste más", async () => {
    const { service, compras } = crear();
    await service.registrar("e1", "u1", { sucursalId: "s1", insumoId: "leche", cantidadCaptura: 1, factor: 1000, precioCaptura: 20, fechaCompra: "2026-10-01T18:00:00Z" });
    await service.registrar("e1", "u1", { sucursalId: "s1", insumoId: "leche", cantidadCaptura: 1, factor: 1000, precioCaptura: 23, fechaCompra: "2026-11-01T18:00:00Z" });
    expect(compras.map((c) => c.precioCaptura)).toEqual([20, 23]);
  });

  it("rechaza datos inválidos e insumos de otra empresa", async () => {
    const { service, prisma } = crear();
    await expect(service.registrar("e1", "u1", { sucursalId: "s1", insumoId: "leche", cantidadCaptura: 0, precioCaptura: 1 })).rejects.toThrow();
    prisma.insumo.findUnique.mockResolvedValueOnce({ id: "x", empresaId: "otra" });
    await expect(service.registrar("e1", "u1", { sucursalId: "s1", insumoId: "x", cantidadCaptura: 1, precioCaptura: 1 })).rejects.toThrow("no existe");
  });

  it("anular: SALIDA por la misma cantidad, queda quién y por qué, y no se anula dos veces", async () => {
    const { service, movimientos, compras } = crear();
    await service.registrar("e1", "u1", { sucursalId: "s1", insumoId: "leche", cantidadCaptura: 20, factor: 1000, precioCaptura: 20 });
    const r = await service.anular("e1", "u-tony", "c1", "Se capturó dos veces");
    expect(movimientos[1]).toMatchObject({ tipo: TipoMovimientoInventario.SALIDA, cantidad: 20000, usuarioId: "u-tony" });
    expect(r).toMatchObject({ estado: "ANULADA", motivoAnulacion: "Se capturó dos veces" });
    expect(compras[0].precioCaptura).toBe(20); // el registro no se modifica, solo se marca
    await expect(service.anular("e1", "u-tony", "c1", "otra vez")).rejects.toThrow("ya estaba anulada");
    await expect(service.anular("e1", "u-tony", "c1", " ")).rejects.toThrow("motivo");
  });
});
