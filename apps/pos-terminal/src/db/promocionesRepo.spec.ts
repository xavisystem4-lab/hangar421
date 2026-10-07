const encolados: any[] = [];
jest.mock("./outboxRepo", () => ({ encolarSync: jest.fn(async (_db: any, evento: any) => { encolados.push(evento); }) }));
jest.mock("./dispositivoLocal", () => ({
  obtenerOCrearDispositivoId: async () => "disp-1",
  obtenerOCrearSucursalIdLocal: async () => "suc-1",
}));

import { SyncEntidad, SyncOperacion } from "@hangar421/shared";
import { alternarPromocion, crearPromocion, editarPromocion, guardarPromocionesRemotas, listarPromociones } from "./promocionesRepo";

function baseFalsa(respuestas: Record<string, any[]> = {}) {
  const ejecutado: { sql: string; params: any[] }[] = [];
  const db: any = {
    runAsync: async (sql: string, ...params: any[]) => { ejecutado.push({ sql: sql.replace(/\s+/g, " ").trim(), params }); },
    getAllAsync: async (sql: string) => {
      const clave = Object.keys(respuestas).find((k) => sql.includes(k));
      return clave ? respuestas[clave] : [];
    },
    withTransactionAsync: async (fn: () => Promise<void>) => { await fn(); },
  };
  const de = (prefijo: string) => ejecutado.filter((e) => e.sql.startsWith(prefijo));
  return { db, ejecutado, de };
}

const DATOS = {
  nombre: "Latte a $49", tipo: "PRECIO" as const, valor: 49, productoIds: ["latte", "capuccino"], dias: [1, 2, 3],
  horaInicio: "14:00", horaFin: "17:00", fechaInicio: "2026-10-01", fechaFin: null, sucursalId: null,
};

beforeEach(() => { encolados.length = 0; });

describe("crearPromocion / editarPromocion", () => {
  it("guarda local (sin confirmar) con sus productos y manda PROMOCION/CREATE con la definición completa", async () => {
    const { db, de } = baseFalsa();
    const id = await crearPromocion(db, DATOS, "user-1");

    const fila = de("INSERT INTO promociones")[0];
    expect(fila.params.slice(0, 5)).toEqual([id, "Latte a $49", "PRECIO", 49, "1,2,3"]);
    expect(fila.params[10]).toBe(1); // activo
    expect(fila.params[11]).toBeNull(); // synced_at: aún sin confirmar
    expect(de("INSERT OR IGNORE INTO promocion_productos").map((e) => e.params)).toEqual([[id, "latte"], [id, "capuccino"]]);

    expect(encolados).toHaveLength(1);
    expect(encolados[0]).toMatchObject({ entidad: SyncEntidad.PROMOCION, operacion: SyncOperacion.CREATE, entidadId: id, sucursalId: "suc-1", usuarioId: "user-1" });
    expect(encolados[0].payload).toEqual({
      nombre: "Latte a $49", tipo: "PRECIO", valor: 49, productoIds: ["latte", "capuccino"], dias: [1, 2, 3],
      horaInicio: "14:00", horaFin: "17:00", fechaInicio: "2026-10-01", fechaFin: null, sucursalId: null, activo: true,
    });
  });

  it("editar manda UPDATE con la definición completa y reemplaza los productos", async () => {
    const { db, de } = baseFalsa();
    await editarPromocion(db, "pr-1", { ...DATOS, tipo: "PORCENTAJE", valor: 20, productoIds: ["pan"] }, true, "user-1");
    expect(de("DELETE FROM promocion_productos")).toHaveLength(1);
    expect(de("INSERT OR IGNORE INTO promocion_productos").map((e) => e.params)).toEqual([["pr-1", "pan"]]);
    expect(encolados[0]).toMatchObject({ operacion: SyncOperacion.UPDATE, entidadId: "pr-1" });
    expect(encolados[0].payload).toMatchObject({ tipo: "PORCENTAJE", valor: 20, productoIds: ["pan"], activo: true });
  });

  it("apagar conserva toda la configuración y manda activo=false", async () => {
    const { db } = baseFalsa();
    await alternarPromocion(db, { ...DATOS, id: "pr-1", activo: true }, false, "user-1");
    expect(encolados[0].payload).toMatchObject({ nombre: "Latte a $49", productoIds: ["latte", "capuccino"], dias: [1, 2, 3], activo: false });
  });
});

describe("listarPromociones", () => {
  it("arma cada promoción con sus productos, días y estado", async () => {
    const { db } = baseFalsa({
      "FROM promociones": [{ id: "pr-1", nombre: "A", tipo: "PRECIO", valor: 49, dias: "1,2,3", hora_inicio: "14:00", hora_fin: null, fecha_inicio: null, fecha_fin: null, sucursal_id: null, activo: 1 },
        { id: "pr-2", nombre: "B", tipo: "PORCENTAJE", valor: 10, dias: "", hora_inicio: null, hora_fin: null, fecha_inicio: null, fecha_fin: null, sucursal_id: "suc-1", activo: 0 }],
      "FROM promocion_productos": [{ promocion_id: "pr-1", producto_id: "latte" }, { promocion_id: "pr-1", producto_id: "pan" }],
    });
    expect(await listarPromociones(db)).toEqual([
      { id: "pr-1", nombre: "A", tipo: "PRECIO", valor: 49, productoIds: ["latte", "pan"], dias: [1, 2, 3], horaInicio: "14:00", horaFin: null, fechaInicio: null, fechaFin: null, sucursalId: null, activo: true },
      { id: "pr-2", nombre: "B", tipo: "PORCENTAJE", valor: 10, productoIds: [], dias: [], horaInicio: null, horaFin: null, fechaInicio: null, fechaFin: null, sucursalId: "suc-1", activo: false },
    ]);
  });
});

describe("guardarPromocionesRemotas", () => {
  it("guarda las del ERP como confirmadas y quita las locales que ya no vienen", async () => {
    const { db, de } = baseFalsa({ "FROM promociones": [{ id: "pr-1" }, { id: "vieja" }] });
    await guardarPromocionesRemotas(db, [{ id: "pr-1", nombre: "A", tipo: "PRECIO", valor: "49.00", productoIds: ["latte"], dias: [1], activo: true }]);
    const fila = de("INSERT INTO promociones")[0];
    expect(fila.params[0]).toBe("pr-1");
    expect(fila.params[3]).toBe(49);
    expect(fila.params[11]).toEqual(expect.any(String)); // synced_at
    expect(de("DELETE FROM promociones").map((e) => e.params)).toEqual([["vieja"]]);
  });

  it("no pisa ni borra una promoción con cambios aún sin subir", async () => {
    const { db, de } = baseFalsa({ "FROM sync_outbox": [{ entidad_id: "pr-1" }, { entidad_id: "nueva-local" }], "FROM promociones": [{ id: "pr-1" }, { id: "nueva-local" }] });
    await guardarPromocionesRemotas(db, [{ id: "pr-1", nombre: "VIEJA", tipo: "PRECIO", valor: 10, activo: true }]);
    expect(de("INSERT INTO promociones")).toHaveLength(0);
    expect(de("DELETE FROM promociones")).toHaveLength(0);
  });
});
