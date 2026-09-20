import { guardarSucursalErp, guardarEmpresaErp, obtenerOCrearEmpresaIdLocal } from "./dispositivoLocal";

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

/** Base falsa con una tabla sync_outbox mínima, para el repunte del empresaId. */
function baseConOutbox(config: Record<string, string>, filas: { local_id: string; payload: any }[]) {
  const outbox = filas.map((f) => ({ local_id: f.local_id, payload: JSON.stringify(f.payload), estado: "PENDING", ultimo_error: "x" }));
  const db = {
    runAsync: async (sql: string, ...params: any[]) => {
      if (sql.startsWith("INSERT INTO config_local")) config[params[0]] = params[1];
      const upd = /^UPDATE sync_outbox SET payload = \?/.test(sql.trim());
      if (upd) {
        const fila = outbox.find((o) => o.local_id === params[1]);
        if (fila) { fila.payload = params[0]; fila.estado = "PENDING"; fila.ultimo_error = null as any; }
      }
    },
    getFirstAsync: async (_sql: string, clave: string) => (config[clave] ? { valor: config[clave] } : null),
    getAllAsync: async () => outbox.filter((o) => o.estado === "PENDING" || o.estado === "ERROR"),
    withTransactionAsync: async (fn: () => Promise<void>) => { await fn(); },
  };
  return { db: db as any, outbox, config };
}

describe("obtenerOCrearEmpresaIdLocal", () => {
  it("prefiere el id REAL del ERP sobre el placeholder", async () => {
    const { db } = baseConOutbox({ empresa_id_erp: "emp-real", empresa_id_local: "placeholder" }, []);
    expect(await obtenerOCrearEmpresaIdLocal(db)).toBe("emp-real");
  });

  it("cae al placeholder mientras no se haya enlazado", async () => {
    const { db } = baseConOutbox({ empresa_id_local: "placeholder" }, []);
    expect(await obtenerOCrearEmpresaIdLocal(db)).toBe("placeholder");
  });

  it("crea un placeholder si no hay ninguno", async () => {
    const { db, config } = baseConOutbox({}, []);
    const id = await obtenerOCrearEmpresaIdLocal(db);
    expect(id).toBeTruthy();
    expect(config["empresa_id_local"]).toBe(id);
  });
});

// El fallo que hacía que una venta nunca apareciera en el ERP: el payload llevaba un empresaId
// inventado en el dispositivo, PedidosService.crear fallaba por clave foránea y la venta se
// quedaba en ERROR mientras la app decía "sincronizado".
describe("guardarEmpresaErp — repunte de ventas encoladas", () => {
  it("sustituye el placeholder por la empresa real en los payloads pendientes", async () => {
    const { db, outbox } = baseConOutbox({ empresa_id_local: "placeholder" }, [
      { local_id: "a", payload: { empresaId: "placeholder", items: [] } },
      { local_id: "b", payload: { empresaId: "placeholder", items: [] } },
    ]);
    await guardarEmpresaErp(db, "emp-real");
    for (const fila of outbox) expect(JSON.parse(fila.payload).empresaId).toBe("emp-real");
  });

  it("devuelve a PENDING y limpia el backoff de las que ya habían fallado", async () => {
    const { db, outbox } = baseConOutbox({ empresa_id_local: "placeholder" }, [
      { local_id: "a", payload: { empresaId: "placeholder" } },
    ]);
    await guardarEmpresaErp(db, "emp-real");
    expect(outbox[0].estado).toBe("PENDING");
    expect(outbox[0].ultimo_error).toBeNull();
  });

  it("no toca payloads de otra empresa", async () => {
    const { db, outbox } = baseConOutbox({ empresa_id_local: "placeholder" }, [
      { local_id: "a", payload: { empresaId: "otra-cosa" } },
    ]);
    await guardarEmpresaErp(db, "emp-real");
    expect(JSON.parse(outbox[0].payload).empresaId).toBe("otra-cosa");
  });

  it("un payload ilegible no impide reparar los demás", async () => {
    const { db, outbox } = baseConOutbox({ empresa_id_local: "placeholder" }, [
      { local_id: "a", payload: { empresaId: "placeholder" } },
    ]);
    outbox.unshift({ local_id: "roto", payload: "{no es json", estado: "PENDING", ultimo_error: null as any });
    await guardarEmpresaErp(db, "emp-real");
    expect(JSON.parse(outbox[1].payload).empresaId).toBe("emp-real");
  });

  it("no hace nada si nunca hubo placeholder", async () => {
    const { db, outbox } = baseConOutbox({}, [{ local_id: "a", payload: { empresaId: "emp-real" } }]);
    await guardarEmpresaErp(db, "emp-real");
    expect(JSON.parse(outbox[0].payload).empresaId).toBe("emp-real");
  });
});
