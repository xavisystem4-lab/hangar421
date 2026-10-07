import { CatalogoService } from "./catalogo.service";

/** Promociones creadas en la terminal: upsert idempotente por id, validaciones y listado. */
function crearPrisma() {
  const promos = new Map<string, any>();
  const links = new Map<string, string[]>();
  const productos: Record<string, any> = { latte: { id: "latte", empresaId: "emp-1" }, pan: { id: "pan", empresaId: "emp-1" }, ajeno: { id: "ajeno", empresaId: "emp-2" } };
  const tx: any = {
    promocion: {
      findUnique: jest.fn(({ where: { id } }: any) => Promise.resolve(promos.get(id) ?? null)),
      create: jest.fn(({ data }: any) => { promos.set(data.id, { ...data }); return Promise.resolve(data); }),
      update: jest.fn(({ where: { id }, data }: any) => { promos.set(id, { ...promos.get(id), ...data }); return Promise.resolve({}); }),
      findMany: jest.fn(() => Promise.resolve([...promos.values()].map((p) => ({ ...p, createdAt: new Date(), productos: (links.get(p.id) ?? []).map((productoId) => ({ productoId })) })))),
    },
    promocionProducto: {
      deleteMany: jest.fn(({ where: { promocionId } }: any) => { links.delete(promocionId); return Promise.resolve({}); }),
      createMany: jest.fn(({ data }: any) => { for (const d of data) links.set(d.promocionId, [...(links.get(d.promocionId) ?? []), d.productoId]); return Promise.resolve({}); }),
    },
    producto: { findMany: jest.fn(({ where }: any) => Promise.resolve(where.id.in.map((id: string) => productos[id]).filter(Boolean))) },
  };
  tx.$transaction = jest.fn((fn: any) => fn(tx));
  return { tx, promos, links };
}

const BASE = { id: "pr-1", empresaId: "emp-1", usuarioId: "u-1", nombre: " Latte a $49 ", tipo: "PRECIO", valor: 49, productoIds: ["latte"], dias: [1, 2, 3], horaInicio: "14:00", horaFin: "17:00", fechaInicio: "2026-10-01", fechaFin: "2026-10-31" };

describe("CatalogoService.guardarPromocionDesdeTerminal", () => {
  it("crea la promoción con el id de la terminal y sus productos", async () => {
    const { tx, promos, links } = crearPrisma();
    const r = await new CatalogoService(tx).guardarPromocionDesdeTerminal(BASE);
    expect(r).toEqual({ id: "pr-1", creada: true });
    expect(promos.get("pr-1")).toMatchObject({ nombre: "Latte a $49", tipo: "PRECIO", valor: 49, dias: [1, 2, 3], horaInicio: "14:00", horaFin: "17:00", sucursalId: null, activo: true, creadaPorId: "u-1", empresaId: "emp-1" });
    expect(links.get("pr-1")).toEqual(["latte"]);
  });

  it("editar es un upsert: reemplaza campos y productos, y apagarla es activo=false", async () => {
    const { tx, promos, links } = crearPrisma();
    const s = new CatalogoService(tx);
    await s.guardarPromocionDesdeTerminal(BASE);
    const r = await s.guardarPromocionDesdeTerminal({ ...BASE, tipo: "PORCENTAJE", valor: 20, productoIds: ["pan", "latte"], activo: false });
    expect(r).toEqual({ id: "pr-1", creada: false });
    expect(tx.promocion.create).toHaveBeenCalledTimes(1);
    expect(promos.get("pr-1")).toMatchObject({ tipo: "PORCENTAJE", valor: 20, activo: false });
    expect(links.get("pr-1")).toEqual(["pan", "latte"]);
  });

  it("reenviar el mismo sobre deja el mismo resultado", async () => {
    const { tx, links } = crearPrisma();
    const s = new CatalogoService(tx);
    await s.guardarPromocionDesdeTerminal(BASE);
    await s.guardarPromocionDesdeTerminal(BASE);
    expect(links.get("pr-1")).toEqual(["latte"]);
  });

  it("rechaza una promoción de otra empresa y productos ajenos o inexistentes", async () => {
    const { tx } = crearPrisma();
    const s = new CatalogoService(tx);
    await s.guardarPromocionDesdeTerminal(BASE);
    await expect(s.guardarPromocionDesdeTerminal({ ...BASE, empresaId: "emp-2", productoIds: ["ajeno"] })).rejects.toThrow("otra empresa");
    await expect(s.guardarPromocionDesdeTerminal({ ...BASE, id: "pr-2", productoIds: ["ajeno"] })).rejects.toThrow("otra empresa");
    await expect(s.guardarPromocionDesdeTerminal({ ...BASE, id: "pr-3", productoIds: ["nadie"] })).rejects.toThrow("no existe");
  });

  it.each([
    ["sin nombre", { nombre: " " }, "nombre"],
    ["tipo inválido", { tipo: "2X1" }, "tipo"],
    ["precio negativo", { valor: -1 }, "valor"],
    ["porcentaje mayor a 100", { tipo: "PORCENTAJE", valor: 120 }, "porcentaje"],
    ["porcentaje cero", { tipo: "PORCENTAJE", valor: 0 }, "porcentaje"],
    ["día fuera de rango", { dias: [7] }, "días"],
    ["hora inválida", { horaInicio: "25:00" }, "hora"],
    ["fin antes del inicio", { horaInicio: "17:00", horaFin: "14:00" }, "posterior"],
    ["fecha inválida", { fechaInicio: "01/10/2026" }, "fecha"],
    ["fechas al revés", { fechaInicio: "2026-11-01", fechaFin: "2026-10-01" }, "posterior"],
    ["sin productos", { productoIds: [] }, "al menos un producto"],
  ])("rechaza %s", async (_caso: string, cambio: any, texto: string) => {
    const { tx } = crearPrisma();
    await expect(new CatalogoService(tx).guardarPromocionDesdeTerminal({ ...BASE, ...cambio })).rejects.toThrow(new RegExp(texto, "i"));
    expect(tx.promocion.create).not.toHaveBeenCalled();
  });

  it("acepta sin días, sin horario y sin fechas (siempre vigente)", async () => {
    const { tx, promos } = crearPrisma();
    await new CatalogoService(tx).guardarPromocionDesdeTerminal({ ...BASE, dias: [], horaInicio: "", horaFin: null, fechaInicio: undefined, fechaFin: "" });
    expect(promos.get("pr-1")).toMatchObject({ dias: [], horaInicio: null, horaFin: null, fechaInicio: null, fechaFin: null });
  });
});

describe("CatalogoService.listarPromociones", () => {
  it("devuelve la definición completa con los ids de producto", async () => {
    const { tx } = crearPrisma();
    const s = new CatalogoService(tx);
    await s.guardarPromocionDesdeTerminal(BASE);
    const lista = await s.listarPromociones("emp-1");
    expect(lista).toEqual([{
      id: "pr-1", nombre: "Latte a $49", tipo: "PRECIO", valor: 49, productoIds: ["latte"], dias: [1, 2, 3],
      horaInicio: "14:00", horaFin: "17:00", fechaInicio: "2026-10-01", fechaFin: "2026-10-31", sucursalId: null, activo: true,
    }]);
  });
});
