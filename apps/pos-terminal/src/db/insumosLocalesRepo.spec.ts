import { actualizarInsumoLocal, cambiarActivoInsumoLocal, crearInsumoLocal, insumosConCambiosPendientes } from "./insumosLocalesRepo";
import type { InsumoValidado } from "../inventario/altaInsumo";

/**
 * "Forbidden resource" al editar un insumo en la tablet: iba directo al ERP. Ahora se guarda en la
 * base local y viaja por la cola (SyncEntidad.INSUMO) cuando hay conexión.
 */
function baseFalsa() {
  const ejecutados: { sql: string; params: any[] }[] = [];
  const db = {
    getFirstAsync: jest.fn(async (_sql: string, clave: string) => (clave === "sucursal_id_erp" ? { valor: "suc-1" } : clave === "dispositivo_id" ? { valor: "disp-1" } : null)),
    getAllAsync: jest.fn(async () => [{ entidad_id: "ins-9" }]),
    runAsync: jest.fn(async (sql: string, ...params: any[]) => { ejecutados.push({ sql, params }); }),
    withTransactionAsync: jest.fn(async (fn: any) => fn()),
  } as any;
  return { db, ejecutados };
}

const LECHUGA: InsumoValidado = {
  nombre: "Lechuga spring mix", unidadMedida: "g", costoUnitario: 0.18, proveedorId: null,
  minimo: 500, maximo: undefined, presentacionNombre: "Bolsa", presentacionCantidad: 500,
};

const outbox = (e: { sql: string; params: any[] }[]) => e.filter((x) => x.sql.includes("INSERT INTO sync_outbox"));

describe("insumos locales", () => {
  it("el alta se guarda en la tablet (sin synced_at) y se encola INSUMO/CREATE", async () => {
    const { db, ejecutados } = baseFalsa();
    const id = await crearInsumoLocal(db, LECHUGA, null, "u1");
    const ins = ejecutados.find((x) => x.sql.includes("INSERT INTO insumos"))!;
    expect(ins.sql).toContain("NULL");
    expect(ins.params[0]).toBe(id);
    const [cola] = outbox(ejecutados);
    expect(cola.params).toEqual(expect.arrayContaining(["INSUMO", "CREATE", id]));
  });

  it("editar pz → g solo cambia la etiqueta (sin conversión) y encola el cambio de unidad", async () => {
    const { db, ejecutados } = baseFalsa();
    await actualizarInsumoLocal(db, "ins-1", LECHUGA, { unidadAnterior: "pz", convertir: false, proveedorNombre: null, usuarioId: "u1" });
    expect(ejecutados.some((x) => x.sql.includes("existencia = existencia *"))).toBe(false);
    const [cola] = outbox(ejecutados);
    expect(JSON.parse(cola.params[8]).cambioUnidad).toEqual({ unidadMedida: "g", convertir: false });
  });

  it("l → ml con conversión reescala existencias y recetas ×1000 en la tablet", async () => {
    const { db, ejecutados } = baseFalsa();
    await actualizarInsumoLocal(db, "leche", { ...LECHUGA, unidadMedida: "ml" }, { unidadAnterior: "l", convertir: true, proveedorNombre: null, usuarioId: null });
    const exist = ejecutados.find((x) => x.sql.includes("existencia = existencia *"))!;
    expect(exist.params[0]).toBe(1000);
    expect(ejecutados.some((x) => x.sql.startsWith("UPDATE recetas_opcion SET cantidad = cantidad *"))).toBe(true);
  });

  it("dar de baja se guarda local y se encola", async () => {
    const { db, ejecutados } = baseFalsa();
    await cambiarActivoInsumoLocal(db, "ins-1", false, "u1");
    expect(ejecutados[0].params).toEqual([0, "ins-1"]);
    expect(outbox(ejecutados)).toHaveLength(1);
  });

  it("sabe qué insumos tienen cambios sin subir (la descarga no los pisa)", async () => {
    const { db } = baseFalsa();
    expect([...(await insumosConCambiosPendientes(db))]).toEqual(["ins-9"]);
  });
});
