import { upsertCatalogo } from "./catalogoSyncRepo";
import { upsertInventario } from "./inventarioRepo";
import { descargaAtrasada, haceCuanto, leerEstadoDescarga, registrarResultadoDescarga } from "./estadoDescargaRepo";

/**
 * "Hicieron cambios en el ERP y no se registraron en la tablet."
 *
 * El ERP solo devuelve lo ACTIVO. Un producto o insumo dado de baja simplemente deja de venir, y
 * como la tablet solo actualizaba lo que llegaba, lo seguía ofreciendo para siempre. Ahora, tras
 * el upsert, se apaga lo del ERP que no vino en esta descarga (marca `synced_at` distinta).
 */
function baseFalsa(config: Record<string, string> = { sucursal_id_erp: "suc-1" }) {
  const ejecutados: { sql: string; params: any[] }[] = [];
  const db = {
    getFirstAsync: jest.fn(async (_sql: string, clave: string) => (config[clave] != null ? { valor: config[clave] } : null)),
    getAllAsync: jest.fn(async () => []),
    runAsync: jest.fn(async (sql: string, ...params: any[]) => {
      ejecutados.push({ sql, params });
      if (sql.startsWith("INSERT INTO config_local")) config[params[0]] = params[1];
    }),
    withTransactionAsync: jest.fn(async (fn: any) => fn()),
  } as any;
  return { db, ejecutados, config };
}

const apagados = (ejecutados: { sql: string }[], tabla: string) =>
  ejecutados.filter((e) => e.sql.startsWith(`UPDATE ${tabla} SET activo = 0`) && e.sql.includes("synced_at <> ?"));

describe("upsertCatalogo — lo que el ERP ya no manda se apaga", () => {
  const producto = { id: "p1", categoriaId: "c1", nombre: "Latte", precioBase: 55, activo: true };

  it("apaga productos y categorías del ERP que no vinieron, con la MISMA marca de tiempo del upsert", async () => {
    const { db, ejecutados } = baseFalsa();
    await upsertCatalogo(db, [{ id: "c1", nombre: "Café", orden: 1, activo: true }], [producto]);

    const insertProducto = ejecutados.find((e) => e.sql.includes("INSERT INTO productos"))!;
    const marca = insertProducto.params[insertProducto.params.length - 1];
    const [prod] = apagados(ejecutados, "productos");
    const [cat] = apagados(ejecutados, "categorias_producto");
    expect(prod.sql).toContain("origen = 'ERP'");
    // Lo creado en esta tablet y aún no confirmado por el ERP (synced_at NULL) no se toca.
    expect(prod.sql).toContain("synced_at IS NOT NULL");
    expect((prod as any).params).toEqual([marca]);
    expect((cat as any).params).toEqual([marca]);
  });

  it("con una respuesta vacía no apaga nada (dejaría la tablet sin catálogo)", async () => {
    const { db, ejecutados } = baseFalsa();
    await upsertCatalogo(db, [], []);
    expect(apagados(ejecutados, "productos")).toHaveLength(0);
    expect(apagados(ejecutados, "categorias_producto")).toHaveLength(0);
  });
});

describe("upsertInventario — insumos dados de baja en el ERP", () => {
  const insumo = { id: "i1", nombre: "Leche de avena", unidadMedida: "ml", costoUnitario: 0.05, activo: true };

  it("apaga los insumos que no vinieron y guarda el empaque que sí viene", async () => {
    const { db, ejecutados } = baseFalsa();
    await upsertInventario(db, [{ ...insumo, presentacionNombre: "Cartón", presentacionCantidad: "1000" }], []);

    const ins = ejecutados.find((e) => e.sql.includes("INSERT INTO insumos"))!;
    expect(ins.params.slice(-3)).toEqual(["Cartón", 1000, 0]);
    const marca = ins.params[7];
    const [apagado] = apagados(ejecutados, "insumos");
    expect(apagado.sql).toContain("synced_at IS NOT NULL");
    expect((apagado as any).params).toEqual([marca]);
  });

  it("sin insumos en la respuesta no apaga ninguno", async () => {
    const { db, ejecutados } = baseFalsa();
    await upsertInventario(db, [], []);
    expect(apagados(ejecutados, "insumos")).toHaveLength(0);
  });
});

describe("estado de la descarga del ERP", () => {
  const ahora = new Date("2026-10-12T18:00:00.000Z");

  it("guarda el último intento y solo mueve 'última completa' cuando salió bien", async () => {
    const { db } = baseFalsa();
    await registrarResultadoDescarga(db, { ok: true, errores: [], fecha: "2026-10-12T17:00:00.000Z" });
    await registrarResultadoDescarga(db, { ok: false, errores: ["Catálogo: network timeout"], fecha: "2026-10-12T17:55:00.000Z" });
    const e = await leerEstadoDescarga(db);
    expect(e.ultimaCompleta).toBe("2026-10-12T17:00:00.000Z");
    expect(e.ultimoIntento).toEqual({ ok: false, errores: ["Catálogo: network timeout"], fecha: "2026-10-12T17:55:00.000Z" });
    expect(descargaAtrasada(e, ahora)).toBe(true); // una hora sin bajar nada
  });

  it("una descarga reciente no está atrasada; nunca haber bajado sí", () => {
    expect(descargaAtrasada({ ultimaCompleta: "2026-10-12T17:58:00.000Z", ultimoIntento: null }, ahora)).toBe(false);
    expect(descargaAtrasada({ ultimaCompleta: null, ultimoIntento: null }, ahora)).toBe(true);
  });

  it("haceCuanto en palabras", () => {
    expect(haceCuanto(null, ahora)).toBe("nunca");
    expect(haceCuanto("2026-10-12T17:59:40.000Z", ahora)).toBe("hace menos de un minuto");
    expect(haceCuanto("2026-10-12T17:47:00.000Z", ahora)).toBe("hace 13 min");
    expect(haceCuanto("2026-10-12T15:00:00.000Z", ahora)).toBe("hace 3 h");
    expect(haceCuanto("2026-10-11T12:00:00.000Z", ahora)).toBe("hace 1 día");
  });
});
