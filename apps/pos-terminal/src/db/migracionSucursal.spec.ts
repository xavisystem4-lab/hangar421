import { MIGRACIONES } from "./migrations";

// expo-sqlite es un módulo nativo y no corre bajo Jest (ver migrations.spec.ts), pero el `up()`
// de una migración es JS normal: se le puede pasar una base falsa que registre el SQL emitido.
// Eso permite fijar la parte arriesgada de la migración 3 —el relleno de `sucursal_id` en las
// filas que ya existían— sin necesitar el runtime de Expo. Si ese relleno falla, las ventas y
// turnos anteriores quedan invisibles para las consultas acotadas.
interface Ejecutado {
  sql: string;
  params: any[];
}

function baseFalsa(config: Record<string, string>) {
  const ejecutado: Ejecutado[] = [];
  const db = {
    execAsync: async (sql: string) => {
      ejecutado.push({ sql, params: [] });
    },
    runAsync: async (sql: string, ...params: any[]) => {
      ejecutado.push({ sql, params });
      const alta = /INSERT INTO config_local \(clave, valor\) VALUES \('([a-z_]+)', \?\)/.exec(sql);
      if (alta) config[alta[1]] = params[0];
    },
    // La migración resuelve la sucursal con una sola consulta que prefiere 'sucursal_id_erp'
    // sobre 'sucursal_id_local' — se emula ese mismo orden de preferencia.
    getFirstAsync: async () => {
      const valor = config["sucursal_id_erp"] ?? config["sucursal_id_local"];
      return valor ? { valor } : null;
    },
  };
  return { db: db as any, ejecutado, config };
}

const migracion3 = MIGRACIONES.find((m) => m.version === 3)!;

function sqlPlano(ejecutado: Ejecutado[]): string {
  return ejecutado.map((e) => e.sql).join("\n");
}

function rellenos(ejecutado: Ejecutado[]): Ejecutado[] {
  return ejecutado.filter((e) => /^UPDATE \w+ SET sucursal_id = \? WHERE sucursal_id = ''$/.test(e.sql.trim()));
}

const TABLAS = ["ventas", "turnos", "movimientos_caja", "usuarios_locales"];

describe("migración 3 — separación por sucursal", () => {
  it("existe y está declarada", () => {
    expect(migracion3).toBeDefined();
    expect(migracion3.nombre).toBe("separacion_por_sucursal");
  });

  it("agrega sucursal_id a las cuatro tablas operativas", async () => {
    const { db, ejecutado } = baseFalsa({ sucursal_id_erp: "suc-erp" });
    await migracion3.up(db);
    const sql = sqlPlano(ejecutado);
    for (const tabla of TABLAS) {
      expect(sql).toContain(`ALTER TABLE ${tabla} ADD COLUMN sucursal_id`);
    }
  });

  it("rellena las filas existentes con el id REAL del ERP cuando el dispositivo ya está enlazado", async () => {
    const { db, ejecutado } = baseFalsa({ sucursal_id_erp: "suc-erp", sucursal_id_local: "placeholder" });
    await migracion3.up(db);

    const updates = rellenos(ejecutado);
    expect(updates).toHaveLength(TABLAS.length);
    for (const u of updates) expect(u.params[0]).toBe("suc-erp");
  });

  it("cae al placeholder local cuando el dispositivo nunca se enlazó", async () => {
    const { db, ejecutado } = baseFalsa({ sucursal_id_local: "placeholder" });
    await migracion3.up(db);
    for (const u of rellenos(ejecutado)) expect(u.params[0]).toBe("placeholder");
  });

  // Un dispositivo puede tener usuarios locales sin haber registrado jamás una venta, y en ese
  // caso no existe ninguna de las dos claves. Dejar las filas con '' las volvería invisibles.
  it("crea un placeholder y lo usa cuando no existe ninguna sucursal guardada", async () => {
    const { db, ejecutado, config } = baseFalsa({});
    await migracion3.up(db);

    expect(config["sucursal_id_local"]).toBeTruthy();
    const updates = rellenos(ejecutado);
    expect(updates).toHaveLength(TABLAS.length);
    for (const u of updates) expect(u.params[0]).toBe(config["sucursal_id_local"]);
  });

  it("no deja ninguna fila sin rellenar", async () => {
    const { db, ejecutado } = baseFalsa({ sucursal_id_erp: "suc-erp" });
    await migracion3.up(db);
    expect(rellenos(ejecutado).map((u) => /^UPDATE (\w+)/.exec(u.sql.trim())![1]).sort()).toEqual([...TABLAS].sort());
  });

  it("hace el folio único por sucursal, no por dispositivo", async () => {
    const { db, ejecutado } = baseFalsa({ sucursal_id_erp: "suc-erp" });
    await migracion3.up(db);
    expect(sqlPlano(ejecutado)).toContain("CREATE UNIQUE INDEX idx_ventas_folio_sucursal ON ventas(sucursal_id, folio_local)");
  });
});
