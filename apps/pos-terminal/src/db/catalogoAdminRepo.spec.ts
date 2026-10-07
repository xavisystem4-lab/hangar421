const encolados: any[] = [];
jest.mock("./outboxRepo", () => ({ encolarSync: jest.fn(async (_db: any, evento: any) => { encolados.push(evento); }) }));
jest.mock("./dispositivoLocal", () => ({
  obtenerOCrearDispositivoId: async () => "disp-1",
  obtenerOCrearSucursalIdLocal: async () => "suc-1",
}));

import { SyncEntidad, SyncOperacion } from "@hangar421/shared";
import { crearModificadorLocal, crearProducto } from "./catalogoAdminRepo";

function baseFalsa() {
  const ejecutado: { sql: string; params: any[] }[] = [];
  const db: any = {
    runAsync: async (sql: string, ...params: any[]) => { ejecutado.push({ sql: sql.replace(/\s+/g, " ").trim(), params }); },
    withTransactionAsync: async (fn: () => Promise<void>) => { await fn(); },
  };
  return { db, ejecutado };
}

beforeEach(() => { encolados.length = 0; });

describe("crearModificadorLocal", () => {
  const datos = { nombre: "Jarabe", tipo: "MULTIPLE" as const, obligatorio: false, opciones: [{ nombre: "Vainilla", precioExtra: 10 }, { nombre: "Caramelo", precioExtra: 12.5 }] };

  it("guarda el grupo con origen TERMINAL (no LOCAL, que se retira al bajar el catálogo) y sus opciones en orden", async () => {
    const { db, ejecutado } = baseFalsa();
    const id = await crearModificadorLocal(db, datos, "user-1");

    const grupo = ejecutado.find((e) => e.sql.startsWith("INSERT INTO modificadores"))!;
    expect(grupo.sql).toContain("'TERMINAL'");
    expect(grupo.params).toEqual([id, "Jarabe", "MULTIPLE", 0]);

    const opciones = ejecutado.filter((e) => e.sql.startsWith("INSERT INTO opciones_modificador"));
    expect(opciones.map((o) => [o.params[1], o.params[2], o.params[3], o.params[4]])).toEqual([
      [id, "Vainilla", 10, 1],
      [id, "Caramelo", 12.5, 2],
    ]);
  });

  it("encola MODIFICADOR/CREATE con los MISMOS ids que quedaron en local", async () => {
    const { db, ejecutado } = baseFalsa();
    const id = await crearModificadorLocal(db, datos, "user-1");

    expect(encolados).toHaveLength(1);
    expect(encolados[0]).toMatchObject({ entidad: SyncEntidad.MODIFICADOR, operacion: SyncOperacion.CREATE, entidadId: id, sucursalId: "suc-1", usuarioId: "user-1" });
    const idsLocales = ejecutado.filter((e) => e.sql.startsWith("INSERT INTO opciones_modificador")).map((o) => o.params[0]);
    expect(encolados[0].payload.opciones.map((o: any) => o.id)).toEqual(idsLocales);
    expect(encolados[0].payload).toMatchObject({ nombre: "Jarabe", tipo: "MULTIPLE", obligatorio: false });
  });

  it("el grupo se encola antes que el producto que lo usa", async () => {
    const { db } = baseFalsa();
    const modId = await crearModificadorLocal(db, datos);
    await crearProducto(db, { categoriaId: "cat-1", nombre: "Latte", precioBase: 80, modificadorIds: [modId] });
    expect(encolados.map((e) => e.entidad)).toEqual([SyncEntidad.MODIFICADOR, SyncEntidad.PRODUCTO]);
    expect(encolados[1].payload.modificadorIds).toEqual([modId]);
  });
});

describe("editarModificadorLocal", () => {
  const edicion = { nombre: "Tipo de leche", tipo: "SELECCION_UNICA" as const, obligatorio: true, opciones: [{ id: "op-1", nombre: "Entera", precioExtra: 0 }, { id: "op-2", nombre: "Avena", precioExtra: 15 }, { nombre: "Almendra", precioExtra: 12 }] };

  it("borra las opciones quitadas, actualiza las que quedan y agrega las nuevas con id propio", async () => {
    const { db, ejecutado } = baseFalsa();
    const { editarModificadorLocal } = await import("./catalogoAdminRepo");
    await editarModificadorLocal(db, "mod-1", edicion, "user-1");

    const actualiza = ejecutado.find((e) => e.sql.startsWith("UPDATE modificadores"))!;
    expect(actualiza.params).toEqual(["Tipo de leche", "SELECCION_UNICA", 1, "mod-1"]);
    const borra = ejecutado.find((e) => e.sql.startsWith("DELETE FROM opciones_modificador"))!;
    expect(borra.params.slice(0, 3)).toEqual(["mod-1", "op-1", "op-2"]);
    expect(borra.params).toHaveLength(4); // + el id generado de la opción nueva
    const upserts = ejecutado.filter((e) => e.sql.startsWith("INSERT INTO opciones_modificador"));
    expect(upserts.map((u) => [u.params[2], u.params[3], u.params[4]])).toEqual([["Entera", 0, 1], ["Avena", 15, 2], ["Almendra", 12, 3]]);
  });

  it("encola MODIFICADOR/UPDATE con la lista completa y los mismos ids", async () => {
    const { db } = baseFalsa();
    const { editarModificadorLocal } = await import("./catalogoAdminRepo");
    await editarModificadorLocal(db, "mod-1", edicion, "user-1");
    expect(encolados).toHaveLength(1);
    expect(encolados[0]).toMatchObject({ entidad: SyncEntidad.MODIFICADOR, operacion: SyncOperacion.UPDATE, entidadId: "mod-1" });
    expect(encolados[0].payload.opciones.map((o: any) => o.nombre)).toEqual(["Entera", "Avena", "Almendra"]);
    expect(encolados[0].payload.opciones[0].id).toBe("op-1");
    expect(encolados[0].payload.opciones[2].id).toEqual(expect.any(String));
  });
});

describe("editarProducto", () => {
  it("manda nombre y categoría como PRODUCTO/UPDATE y el precio como PRODUCTO_SUCURSAL", async () => {
    const { db, ejecutado } = baseFalsa();
    const { editarProducto } = await import("./catalogoAdminRepo");
    await editarProducto(db, "p-1", { nombre: "Latte Vainilla", precioBase: 85, categoriaId: "cat-2" }, "user-1");

    expect(ejecutado.find((e) => e.sql.startsWith("UPDATE productos"))!.params).toEqual(["Latte Vainilla", 85, "cat-2", "p-1"]);
    expect(ejecutado.find((e) => e.sql.startsWith("UPDATE precios_sucursal"))!.params).toEqual([85, "p-1", "suc-1"]);
    expect(encolados.map((e) => [e.entidad, e.operacion])).toEqual([[SyncEntidad.PRODUCTO, SyncOperacion.UPDATE], [SyncEntidad.PRODUCTO_SUCURSAL, SyncOperacion.UPDATE]]);
    expect(encolados[0].payload).toEqual({ nombre: "Latte Vainilla", categoriaId: "cat-2" });
    expect(encolados[1].payload).toEqual({ productoId: "p-1", precio: 85 });
  });

  it("sin cambiar de categoría no manda categoriaId", async () => {
    const { db } = baseFalsa();
    const { editarProducto } = await import("./catalogoAdminRepo");
    await editarProducto(db, "p-1", { nombre: "X", precioBase: 10 }, "user-1");
    expect(encolados[0].payload).toEqual({ nombre: "X" });
  });
});
