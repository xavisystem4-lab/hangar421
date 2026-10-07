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
