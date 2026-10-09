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

/** Edición de un grupo: opciones nuevas, precios, y quitar (borrar si nunca se vendió, apagar si sí). */
function prismaEdicion(usos: Record<string, number> = {}) {
  const opciones = new Map<string, any>([
    ["op-1", { id: "op-1", modificadorId: "mod-1", nombre: "Entera", precioExtra: 0, orden: 1, activo: true }],
    ["op-2", { id: "op-2", modificadorId: "mod-1", nombre: "Avena", precioExtra: 10, orden: 2, activo: true }],
    ["op-3", { id: "op-3", modificadorId: "mod-1", nombre: "Soya", precioExtra: 10, orden: 3, activo: true }],
    ["op-otro", { id: "op-otro", modificadorId: "mod-9", nombre: "Ajena", precioExtra: 0, orden: 1, activo: true }],
  ]);
  const grupos: Record<string, any> = { "mod-1": { empresaId: "emp-1", nombre: "Leche" }, "mod-ajeno": { empresaId: "emp-2" } };
  const tx: any = {
    modificador: {
      findUnique: jest.fn(({ where: { id } }: any) => Promise.resolve(grupos[id] ? { ...grupos[id], opciones: [...opciones.values()].filter((o) => o.modificadorId === id).map((o) => ({ id: o.id })) } : null)),
      update: jest.fn(({ where: { id }, data }: any) => { grupos[id] = { ...grupos[id], ...data }; return Promise.resolve(grupos[id]); }),
    },
    opcionModificador: {
      findUnique: jest.fn(({ where: { id } }: any) => Promise.resolve(opciones.get(id) ?? null)),
      upsert: jest.fn(({ where: { id }, update, create }: any) => { opciones.set(id, opciones.has(id) ? { ...opciones.get(id), ...update } : { ...create, activo: true }); return Promise.resolve({}); }),
      create: jest.fn(({ data }: any) => { opciones.set(`nueva-${opciones.size}`, { ...data, activo: true }); return Promise.resolve({}); }),
      update: jest.fn(({ where: { id }, data }: any) => { opciones.set(id, { ...opciones.get(id), ...data }); return Promise.resolve({}); }),
      delete: jest.fn(({ where: { id } }: any) => { opciones.delete(id); return Promise.resolve({}); }),
    },
    pedidoItemModificador: { count: jest.fn(({ where: { opcionModificadorId } }: any) => Promise.resolve(usos[opcionModificadorId] ?? 0)) },
  };
  tx.$transaction = jest.fn((fn: any) => fn(tx));
  return { tx, opciones, grupos };
}

describe("CatalogoService.editarModificadorDesdeTerminal", () => {
  const EDICION = {
    id: "mod-1", empresaId: "emp-1", nombre: " Tipo de leche ", tipo: "SELECCION_UNICA", obligatorio: true,
    opciones: [{ id: "op-1", nombre: "Entera", precioExtra: 0 }, { id: "op-2", nombre: "Avena", precioExtra: 15 }, { nombre: "Almendra", precioExtra: 12 }],
  };

  it("cambia el grupo, los precios, agrega opciones nuevas y quita la que ya no viene", async () => {
    const { tx, opciones, grupos } = prismaEdicion();
    const r = await new CatalogoService(tx).editarModificadorDesdeTerminal(EDICION);

    expect(r).toEqual({ id: "mod-1", opciones: 3, quitadas: 1 });
    expect(grupos["mod-1"]).toMatchObject({ nombre: "Tipo de leche", obligatorio: true });
    expect(opciones.get("op-2")).toMatchObject({ precioExtra: 15, orden: 2 });
    expect([...opciones.values()].some((o) => o.nombre === "Almendra" && o.modificadorId === "mod-1")).toBe(true);
    expect(opciones.has("op-3")).toBe(false); // Soya nunca se vendió: se borra
  });

  it("una opción quitada que ya se vendió se apaga, no se borra", async () => {
    const { tx, opciones } = prismaEdicion({ "op-3": 4 });
    await new CatalogoService(tx).editarModificadorDesdeTerminal(EDICION);
    expect(opciones.get("op-3")).toMatchObject({ activo: false });
  });

  it("rechaza un grupo inexistente, de otra empresa o con una opción de otro grupo", async () => {
    const { tx } = prismaEdicion();
    const s = new CatalogoService(tx);
    await expect(s.editarModificadorDesdeTerminal({ ...EDICION, id: "nadie" })).rejects.toThrow("no existe");
    await expect(s.editarModificadorDesdeTerminal({ ...EDICION, id: "mod-ajeno" })).rejects.toThrow("otra empresa");
    await expect(s.editarModificadorDesdeTerminal({ ...EDICION, opciones: [{ id: "op-otro", nombre: "X", precioExtra: 0 }] })).rejects.toThrow("otro modificador");
    expect(tx.modificador.update).not.toHaveBeenCalled();
  });

  it("no deja un grupo sin opciones", async () => {
    const { tx } = prismaEdicion();
    await expect(new CatalogoService(tx).editarModificadorDesdeTerminal({ ...EDICION, opciones: [] })).rejects.toThrow("al menos una opción");
  });
});

describe("CatalogoService.editarDatosProducto", () => {
  it("cambia nombre y categoría, y no toca nada si no llega nada", async () => {
    const { cliente, productos } = crearPrismaFalso();
    productos.set("p-1", { id: "p-1", empresaId: "emp-1", nombre: "Latte" });
    const s = new CatalogoService(cliente);
    expect(await s.editarDatosProducto("emp-1", "p-1", { nombre: " Latte Vainilla ", categoriaId: "cat-1" })).toEqual({ id: "p-1", cambios: 2 });
    expect(productos.get("p-1")).toMatchObject({ nombre: "Latte Vainilla", categoriaId: "cat-1" });
    expect(await s.editarDatosProducto("emp-1", "p-1", {})).toEqual({ id: "p-1", cambios: 0 });
  });

  it("rechaza producto ajeno, nombre vacío y categoría de otra empresa", async () => {
    const { cliente, productos } = crearPrismaFalso();
    productos.set("p-1", { id: "p-1", empresaId: "emp-1" });
    productos.set("p-2", { id: "p-2", empresaId: "emp-2" });
    const s = new CatalogoService(cliente);
    await expect(s.editarDatosProducto("emp-1", "p-2", { nombre: "X" })).rejects.toThrow("otra empresa");
    await expect(s.editarDatosProducto("emp-1", "p-1", { nombre: "  " })).rejects.toThrow("no tiene nombre");
    await expect(s.editarDatosProducto("emp-1", "p-1", { categoriaId: "cat-ajena" })).rejects.toThrow("no existe");
  });
});

/** Alta desde el ERP (CRM → Catálogo → Nuevo producto): el id lo genera el servidor, los
 *  modificadores se validan igual que desde la terminal y `sucursalIds` decide dónde queda en
 *  venta; sin esa lista no se crea ningún renglón por sucursal (disponible en todas). */
describe("CatalogoService.crearProducto (desde el ERP)", () => {
  function conSucursales() {
    const { cliente, productos, links, porSucursal } = crearPrismaFalso();
    cliente.sucursal.findMany = jest.fn(() => Promise.resolve([{ id: "suc-1" }, { id: "suc-2" }, { id: "suc-3" }]));
    cliente.producto.create = jest.fn(({ data }: any) => { const p = { id: "prod-erp", ...data }; productos.set(p.id, p); return Promise.resolve(p); });
    return { cliente, productos, links, porSucursal };
  }
  const DATOS = { empresaId: "emp-1", categoriaId: "cat-1", nombre: " Matcha Latte ", precioBase: 85 };

  it("crea el producto con sus modificadores y lo deja en venta solo en las sucursales elegidas", async () => {
    const { cliente, productos, links, porSucursal } = conSucursales();
    const r = await new CatalogoService(cliente).crearProducto({ ...DATOS, modificadorIds: ["mod-2", "mod-1", "mod-2"], estacionPreparacion: "BARRA", sucursalIds: ["suc-1", "suc-3"] });
    expect(r.id).toBe("prod-erp");
    expect(productos.get("prod-erp")).toMatchObject({ nombre: "Matcha Latte", precioBase: 85, requierePersonalizacion: true, estacionPreparacion: "BARRA", empresaId: "emp-1" });
    expect([...links.values()].map((l) => [l.modificadorId, l.orden])).toEqual([["mod-2", 1], ["mod-1", 2]]);
    expect(porSucursal.get("prod-erp|suc-1")).toMatchObject({ disponible: true, precio: 85 });
    expect(porSucursal.get("prod-erp|suc-2")).toMatchObject({ disponible: false });
    expect(porSucursal.get("prod-erp|suc-3")).toMatchObject({ disponible: true });
  });

  it("sin modificadores ni lista de sucursales: no pregunta nada y queda disponible en todas (sin renglones)", async () => {
    const { cliente, productos, porSucursal } = conSucursales();
    await new CatalogoService(cliente).crearProducto({ ...DATOS });
    expect(productos.get("prod-erp").requierePersonalizacion).toBe(false);
    expect(porSucursal.size).toBe(0);
  });

  it("rechaza nombre vacío, precio inválido, categoría ajena y modificadores ajenos", async () => {
    const { cliente } = conSucursales();
    const s = new CatalogoService(cliente);
    await expect(s.crearProducto({ ...DATOS, nombre: "  " })).rejects.toThrow("no tiene nombre");
    await expect(s.crearProducto({ ...DATOS, precioBase: -1 })).rejects.toThrow("precio");
    await expect(s.crearProducto({ ...DATOS, categoriaId: "cat-ajena" })).rejects.toThrow("categoría");
    await expect(s.crearProducto({ ...DATOS, modificadorIds: ["mod-ajeno"] })).rejects.toThrow("otra empresa");
    expect(cliente.producto.create).not.toHaveBeenCalled();
  });
});
