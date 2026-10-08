import { PedidosService, datosDeProductoSembrado } from "./pedidos.service";

/**
 * Regresión: una venta de la tablet con un producto que el ERP no tiene (sembrado en la tablet,
 * `hangar-prod-…`) se rechazaba entera con "ya no existe en el catálogo" y se reintentaba para
 * siempre; detrás de ella su cobro fallaba con "Pedido no encontrado" (Benito Juárez, 19/09).
 * Desde la cola offline ahora se registra el producto inactivo con lo que se cobró.
 */
function crearServicio(productos: Record<string, any> = {}, categorias: any[] = []) {
  const creados: any = { productos: [] as any[], categorias: [] as any[] };
  const prisma = {
    producto: {
      findUnique: jest.fn(({ where: { id } }: any) => Promise.resolve(productos[id] ?? null)),
      upsert: jest.fn(({ create }: any) => {
        creados.productos.push(create);
        return Promise.resolve({ ...create, precioBase: create.precioBase });
      }),
    },
    productoSucursal: { findUnique: jest.fn(() => Promise.resolve(null)) },
    categoriaProducto: {
      findFirst: jest.fn(() => Promise.resolve(categorias[0] ?? null)),
      create: jest.fn(({ data }: any) => {
        creados.categorias.push(data);
        return Promise.resolve({ id: "cat-fuera" });
      }),
    },
    opcionModificador: { findMany: jest.fn(() => Promise.resolve([])) },
  };
  const service = new PedidosService(prisma as any, {} as any, {} as any);
  (service as any).precioEnSucursal = jest.fn((p: any) => Promise.resolve(Number(p.precioBase)));
  const resolver = (item: any, empresa?: string) => (service as any).resolverItem(item, "suc-1", empresa);
  return { resolver, creados, prisma };
}

describe("datosDeProductoSembrado", () => {
  it("saca nombre y precio del id sembrado en la tablet", () => {
    expect(datosDeProductoSembrado("hangar-prod-bebidas-calientes-capuccino-85")).toEqual({ nombre: "Bebidas calientes capuccino", precio: 85 });
  });

  it("null para un id normal", () => {
    expect(datosDeProductoSembrado("0192a3b4-uuid")).toBeNull();
  });
});

describe("PedidosService.resolverItem — producto fuera de catálogo", () => {
  it("desde la cola offline registra el producto inactivo con el precio del id sembrado", async () => {
    const { resolver, creados } = crearServicio();
    const r = await resolver({ productoId: "hangar-prod-bebidas-calientes-capuccino-85", cantidad: 1 }, "emp-1");
    expect(r.precioUnitario).toBe(85);
    expect(creados.productos[0]).toMatchObject({ id: "hangar-prod-bebidas-calientes-capuccino-85", empresaId: "emp-1", activo: false, precioBase: 85 });
    expect(creados.categorias[0]).toMatchObject({ nombre: "Fuera de catálogo", activo: false });
  });

  it("prefiere el nombre y precio que manda la tablet", async () => {
    const { resolver, creados } = crearServicio({}, [{ id: "cat-existente" }]);
    const r = await resolver({ productoId: "prod-borrado", cantidad: 2, nombreProducto: "Chai latte", precioUnitario: 72 }, "emp-1");
    expect(r).toMatchObject({ nombreProducto: "Chai latte", precioUnitario: 72 });
    expect(creados.productos[0]).toMatchObject({ categoriaId: "cat-existente", nombre: "Chai latte" });
    expect(creados.categorias).toHaveLength(0);
  });

  it("una venta en línea (sin empresa de la cola) se sigue rechazando", async () => {
    const { resolver, prisma } = crearServicio();
    await expect(resolver({ productoId: "prod-borrado", cantidad: 1 })).rejects.toThrow(/ya no existe en el catálogo/);
    expect(prisma.producto.upsert).not.toHaveBeenCalled();
  });
});
