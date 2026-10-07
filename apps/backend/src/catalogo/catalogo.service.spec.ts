import { CatalogoService } from "./catalogo.service";

/** Alta de producto desde la terminal: idempotencia por id, validación de categoría y
 *  modificadores de la empresa, y disponibilidad por sucursal (en venta donde se creó, standby
 *  en las demás). Prisma se simula con mapas en memoria; `$transaction` ejecuta el bloque con
 *  el mismo cliente falso. */
function crearPrismaFalso() {
  const productos = new Map<string, any>();
  const links = new Map<string, { productoId: string; modificadorId: string; orden: number }>();
  const porSucursal = new Map<string, any>();
  const categorias: Record<string, any> = { "cat-1": { empresaId: "emp-1" }, "cat-ajena": { empresaId: "emp-2" } };
  const modificadores: Record<string, any> = { "mod-1": { id: "mod-1", empresaId: "emp-1" }, "mod-2": { id: "mod-2", empresaId: "emp-1" }, "mod-ajeno": { id: "mod-ajeno", empresaId: "emp-2" } };

  const cliente: any = {
    categoriaProducto: { findUnique: jest.fn(({ where: { id } }: any) => Promise.resolve(categorias[id] ?? null)) },
    modificador: {
      findUnique: jest.fn(({ where: { id } }: any) => Promise.resolve(modificadores[id] ?? null)),
      create: jest.fn(({ data }: any) => { modificadores[data.id] = { ...data }; return Promise.resolve(data); }),
      findMany: jest.fn(({ where }: any) => Promise.resolve(where.id.in.map((id: string) => modificadores[id]).filter(Boolean))),
    },
    producto: {
      findUnique: jest.fn(({ where: { id } }: any) => Promise.resolve(productos.get(id) ?? null)),
      create: jest.fn(({ data }: any) => { productos.set(data.id, { ...data }); return Promise.resolve(data); }),
      update: jest.fn(({ where: { id }, data }: any) => { productos.set(id, { ...productos.get(id), ...data }); return Promise.resolve(productos.get(id)); }),
    },
    productoModificador: {
      deleteMany: jest.fn(({ where: { productoId } }: any) => {
        for (const [k, v] of links) if (v.productoId === productoId) links.delete(k);
        return Promise.resolve({});
      }),
      createMany: jest.fn(({ data }: any) => { for (const d of data) links.set(`${d.productoId}|${d.modificadorId}`, d); return Promise.resolve({}); }),
    },
    productoSucursal: {
      upsert: jest.fn(({ where: { productoId_sucursalId: k }, update, create }: any) => {
        const clave = `${k.productoId}|${k.sucursalId}`;
        porSucursal.set(clave, porSucursal.has(clave) ? { ...porSucursal.get(clave), ...update } : create);
        return Promise.resolve(porSucursal.get(clave));
      }),
      createMany: jest.fn(({ data }: any) => {
        for (const d of data) { const clave = `${d.productoId}|${d.sucursalId}`; if (!porSucursal.has(clave)) porSucursal.set(clave, d); }
        return Promise.resolve({});
      }),
    },
    sucursal: { findMany: jest.fn(() => Promise.resolve([{ id: "suc-2" }, { id: "suc-3" }])) },
  };
  cliente.$transaction = jest.fn((fn: any) => fn(cliente));
  return { cliente, productos, links, porSucursal };
}

const BASE = { id: "prod-nuevo", empresaId: "emp-1", sucursalId: "suc-1", categoriaId: "cat-1", nombre: " Latte Lavanda ", precioBase: 95 };

describe("CatalogoService.altaProductoDesdeTerminal", () => {
  it("crea el producto con el id de la terminal, sus modificadores en orden y lo deja en venta solo en su sucursal", async () => {
    const { cliente, productos, links, porSucursal } = crearPrismaFalso();
    const servicio = new CatalogoService(cliente);

    const r = await servicio.altaProductoDesdeTerminal({ ...BASE, modificadorIds: ["mod-2", "mod-1", "mod-2"] });

    expect(r).toEqual({ id: "prod-nuevo", creado: true });
    expect(productos.get("prod-nuevo")).toMatchObject({ nombre: "Latte Lavanda", precioBase: 95, requierePersonalizacion: true, categoriaId: "cat-1", empresaId: "emp-1" });
    expect([...links.values()]).toEqual([
      { productoId: "prod-nuevo", modificadorId: "mod-2", orden: 1 },
      { productoId: "prod-nuevo", modificadorId: "mod-1", orden: 2 },
    ]);
    expect(porSucursal.get("prod-nuevo|suc-1")).toMatchObject({ precio: 95, disponible: true });
    expect(porSucursal.get("prod-nuevo|suc-2")).toMatchObject({ disponible: false });
    expect(porSucursal.get("prod-nuevo|suc-3")).toMatchObject({ disponible: false });
  });

  it("sin modificadores no abre el modal", async () => {
    const { cliente, productos } = crearPrismaFalso();
    await new CatalogoService(cliente).altaProductoDesdeTerminal({ ...BASE });
    expect(productos.get("prod-nuevo").requierePersonalizacion).toBe(false);
  });

  it("es idempotente: el reenvío no duplica ni cambia lo que ya está", async () => {
    const { cliente, productos, porSucursal } = crearPrismaFalso();
    const servicio = new CatalogoService(cliente);
    await servicio.altaProductoDesdeTerminal({ ...BASE, modificadorIds: ["mod-1"] });
    // Mientras tanto alguien lo puso en venta en suc-2 desde el CRM.
    porSucursal.set("prod-nuevo|suc-2", { productoId: "prod-nuevo", sucursalId: "suc-2", precio: 95, disponible: true });

    const r = await servicio.altaProductoDesdeTerminal({ ...BASE, modificadorIds: ["mod-1"] });

    expect(r.creado).toBe(false);
    expect(cliente.producto.create).toHaveBeenCalledTimes(1);
    expect(productos.size).toBe(1);
    expect(porSucursal.get("prod-nuevo|suc-2").disponible).toBe(true);
  });

  it("rechaza categoría o modificadores que no son de la empresa, y datos inválidos", async () => {
    const { cliente, productos } = crearPrismaFalso();
    const servicio = new CatalogoService(cliente);
    await expect(servicio.altaProductoDesdeTerminal({ ...BASE, categoriaId: "cat-ajena" })).rejects.toThrow(/categoría del producto no existe/);
    await expect(servicio.altaProductoDesdeTerminal({ ...BASE, categoriaId: "cat-x" })).rejects.toThrow(/categoría del producto no existe/);
    await expect(servicio.altaProductoDesdeTerminal({ ...BASE, modificadorIds: ["mod-ajeno"] })).rejects.toThrow(/otra empresa/);
    await expect(servicio.altaProductoDesdeTerminal({ ...BASE, modificadorIds: ["mod-inexistente"] })).rejects.toThrow(/no existe en el ERP/);
    await expect(servicio.altaProductoDesdeTerminal({ ...BASE, nombre: "  " })).rejects.toThrow(/no tiene nombre/);
    await expect(servicio.altaProductoDesdeTerminal({ ...BASE, precioBase: Number("abc") })).rejects.toThrow(/precio/);
    expect(productos.size).toBe(0);
  });
});

describe("CatalogoService.fijarModificadoresDeProducto", () => {
  it("reemplaza la lista y ajusta requierePersonalizacion", async () => {
    const { cliente, productos, links } = crearPrismaFalso();
    const servicio = new CatalogoService(cliente);
    await servicio.altaProductoDesdeTerminal({ ...BASE, modificadorIds: ["mod-1", "mod-2"] });

    await servicio.fijarModificadoresDeProducto("emp-1", "prod-nuevo", ["mod-2"]);
    expect([...links.values()]).toEqual([{ productoId: "prod-nuevo", modificadorId: "mod-2", orden: 1 }]);
    expect(productos.get("prod-nuevo").requierePersonalizacion).toBe(true);

    await servicio.fijarModificadoresDeProducto("emp-1", "prod-nuevo", []);
    expect(links.size).toBe(0);
    expect(productos.get("prod-nuevo").requierePersonalizacion).toBe(false);
  });

  it("no toca productos inexistentes ni de otra empresa", async () => {
    const { cliente } = crearPrismaFalso();
    const servicio = new CatalogoService(cliente);
    await expect(servicio.fijarModificadoresDeProducto("emp-1", "nada", [])).rejects.toThrow(/no existe/);
    await servicio.altaProductoDesdeTerminal({ ...BASE });
    await expect(servicio.fijarModificadoresDeProducto("emp-2", "prod-nuevo", [])).rejects.toThrow(/otra empresa/);
  });
});

describe("CatalogoService.crearModificadorDesdeTerminal", () => {
  const GRUPO = {
    id: "mod-nuevo", empresaId: "emp-1", nombre: " Jarabe ", tipo: "MULTIPLE", obligatorio: false,
    opciones: [{ id: "op-1", nombre: " Vainilla ", precioExtra: 10 }, { id: "op-2", nombre: "Caramelo", precioExtra: 12.5 }],
  };

  it("crea el grupo con los ids de la terminal y las opciones en orden", async () => {
    const { cliente } = crearPrismaFalso();
    const r = await new CatalogoService(cliente).crearModificadorDesdeTerminal(GRUPO);
    expect(r).toEqual({ id: "mod-nuevo", creado: true });
    expect(cliente.modificador.create).toHaveBeenCalledWith({
      data: {
        id: "mod-nuevo", empresaId: "emp-1", nombre: "Jarabe", tipo: "MULTIPLE", obligatorio: false,
        opciones: { create: [
          { id: "op-1", nombre: "Vainilla", precioExtra: 10, orden: 1 },
          { id: "op-2", nombre: "Caramelo", precioExtra: 12.5, orden: 2 },
        ] },
      },
    });
  });

  it("es idempotente: reenviar el mismo grupo no lo duplica", async () => {
    const { cliente } = crearPrismaFalso();
    const servicio = new CatalogoService(cliente);
    await servicio.crearModificadorDesdeTerminal(GRUPO);
    const r = await servicio.crearModificadorDesdeTerminal(GRUPO);
    expect(r).toEqual({ id: "mod-nuevo", creado: false });
    expect(cliente.modificador.create).toHaveBeenCalledTimes(1);
  });

  it("rechaza el id de otra empresa", async () => {
    const { cliente } = crearPrismaFalso();
    await expect(new CatalogoService(cliente).crearModificadorDesdeTerminal({ ...GRUPO, id: "mod-ajeno" })).rejects.toThrow("otra empresa");
  });

  it.each([
    ["sin nombre", { nombre: "  " }, "no tiene nombre"],
    ["tipo inválido", { tipo: "OTRO" }, "tipo del modificador"],
    ["sin opciones", { opciones: [] }, "al menos una opción"],
    ["opción sin nombre", { opciones: [{ nombre: " ", precioExtra: 0 }] }, "no tiene nombre"],
    ["precio negativo", { opciones: [{ nombre: "X", precioExtra: -1 }] }, "no es válido"],
  ])("rechaza %s", async (_caso: string, cambio: any, mensaje: string) => {
    const { cliente } = crearPrismaFalso();
    await expect(new CatalogoService(cliente).crearModificadorDesdeTerminal({ ...GRUPO, ...cambio })).rejects.toThrow(mensaje);
    expect(cliente.modificador.create).not.toHaveBeenCalled();
  });
});
