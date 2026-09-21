import { SyncEntidad, SyncOperacion } from "@hangar421/shared";
import { solicitarAltaProducto } from "./solicitudesProductoRepo";

// Base falsa (ver migracionSucursal.spec.ts): se prueba qué se encola, no el motor SQL.
function baseFalsa() {
  const encolados: any[][] = [];
  const db = {
    getFirstAsync: async (sql: string, ...params: any[]) => {
      if (sql.includes("orden_secuencia")) return { orden: encolados.length + 1 };
      if (sql.includes("FROM config_local")) return params[0] === "sucursal_id_erp" ? { valor: "suc-1" } : { valor: "dev-1" };
      return null;
    },
    runAsync: async (sql: string, ...params: any[]) => {
      if (sql.includes("INSERT INTO sync_outbox")) encolados.push(params);
    },
  };
  return { db: db as any, encolados };
}

describe("solicitarAltaProducto", () => {
  it("encola la solicitud con el texto, la sucursal y quien la pidió — nunca un producto", async () => {
    const { db, encolados } = baseFalsa();
    const id = await solicitarAltaProducto(db, { texto: "  Chai   latte de avena ", usuarioId: "u-ana" });

    // Columnas: local_id, entidad, operacion, entidad_id, idempotency_key, sucursal_id, dispositivo_id, usuario_id, payload, …
    const [, entidad, operacion, entidadId, , sucursalId, , usuarioId, payload] = encolados[0];
    expect(entidad).toBe(SyncEntidad.SOLICITUD_PRODUCTO);
    expect(operacion).toBe(SyncOperacion.CREATE);
    expect(entidadId).toBe(id);
    expect(sucursalId).toBe("suc-1");
    expect(usuarioId).toBe("u-ana");
    expect(JSON.parse(payload)).toEqual({ texto: "Chai latte de avena" });
  });

  it("no encola nada con un texto vacío", async () => {
    const { db, encolados } = baseFalsa();
    await expect(solicitarAltaProducto(db, { texto: "   " })).rejects.toThrow();
    expect(encolados).toHaveLength(0);
  });
});
