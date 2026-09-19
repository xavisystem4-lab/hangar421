import { guardarSucursalErp } from "./dispositivoLocal";

// Mismo enfoque que migracionSucursal.spec.ts: base falsa que registra el SQL, sin expo-sqlite.
// Lo que se fija aquí es el repunte al enlazar — si falla, un dispositivo que vendió offline y
// luego se conecta ve desaparecer su historial, su turno abierto y sus usuarios locales, porque
// esas filas se quedan con el placeholder mientras las consultas pasan a usar el id del ERP.
interface Ejecutado {
  sql: string;
  params: any[];
}

function baseFalsa(config: Record<string, string>) {
  const ejecutado: Ejecutado[] = [];
  const db = {
    runAsync: async (sql: string, ...params: any[]) => {
      ejecutado.push({ sql, params });
      if (sql.startsWith("INSERT INTO config_local")) config[params[0]] = params[1];
    },
    getFirstAsync: async (_sql: string, clave: string) => {
      const valor = config[clave];
      return valor ? { valor } : null;
    },
    withTransactionAsync: async (fn: () => Promise<void>) => {
      await fn();
    },
  };
  return { db: db as any, ejecutado, config };
}

function repuntes(ejecutado: Ejecutado[]): Ejecutado[] {
  return ejecutado.filter((e) => /^UPDATE \w+ SET sucursal_id = \? WHERE sucursal_id = \?$/.test(e.sql.trim()));
}

// sync_outbox incluido a propósito: sus eventos pendientes viajan con ese sucursal_id y
// SucursalAccessGuard los rechazaría con 403 si se quedaran con el placeholder.
const TABLAS = ["ventas", "turnos", "movimientos_caja", "usuarios_locales", "sync_outbox"];

describe("guardarSucursalErp", () => {
  it("guarda el id de la sucursal del ERP", async () => {
    const { db, config } = baseFalsa({});
    await guardarSucursalErp(db, "suc-erp");
    expect(config["sucursal_id_erp"]).toBe("suc-erp");
  });

  it("repunta a la sucursal real lo registrado antes de enlazar", async () => {
    const { db, ejecutado } = baseFalsa({ sucursal_id_local: "placeholder" });
    await guardarSucursalErp(db, "suc-erp");

    const movidos = repuntes(ejecutado);
    expect(movidos).toHaveLength(TABLAS.length);
    for (const m of movidos) expect(m.params).toEqual(["suc-erp", "placeholder"]);
    expect(movidos.map((m) => /^UPDATE (\w+)/.exec(m.sql.trim())![1]).sort()).toEqual([...TABLAS].sort());
  });

  it("no repunta nada si el dispositivo nunca usó un placeholder", async () => {
    const { db, ejecutado } = baseFalsa({});
    await guardarSucursalErp(db, "suc-erp");
    expect(repuntes(ejecutado)).toHaveLength(0);
  });

  // Reenlazar a la MISMA sucursal no debe mover nada — y sobre todo no debe chocar contra el
  // índice único (sucursal_id, folio_local) intentando mover filas sobre sí mismas.
  it("no repunta si el placeholder ya es la sucursal destino", async () => {
    const { db, ejecutado } = baseFalsa({ sucursal_id_local: "suc-erp" });
    await guardarSucursalErp(db, "suc-erp");
    expect(repuntes(ejecutado)).toHaveLength(0);
  });

  it("escribe el marcador y mueve los datos en la misma transacción", async () => {
    const { db, ejecutado } = baseFalsa({ sucursal_id_local: "placeholder" });
    let dentroDeTransaccion = false;
    db.withTransactionAsync = async (fn: () => Promise<void>) => {
      dentroDeTransaccion = true;
      await fn();
      dentroDeTransaccion = false;
    };
    await guardarSucursalErp(db, "suc-erp");
    expect(dentroDeTransaccion).toBe(false);
    expect(ejecutado.length).toBeGreaterThan(TABLAS.length); // marcador + los cuatro repuntes
  });
});
