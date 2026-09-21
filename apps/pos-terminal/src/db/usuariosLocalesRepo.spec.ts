import { SyncEntidad, SyncOperacion } from "@hangar421/shared";
import { encolarUsuariosSinRegistrarEnErp } from "./usuariosLocalesRepo";

// Base falsa (ver migracionSucursal.spec.ts): expo-sqlite no corre bajo Jest, pero lo que importa
// aquí es qué se encola y con qué datos, no el motor SQL.
function baseFalsa(faltantes: any[]) {
  const encolados: any[][] = [];
  const consultas: string[] = [];
  const db = {
    getAllAsync: async (sql: string) => {
      consultas.push(sql);
      return faltantes;
    },
    getFirstAsync: async (sql: string) => (sql.includes("orden_secuencia") ? { orden: encolados.length + 1 } : { valor: "dev-1" }),
    runAsync: async (sql: string, ...params: any[]) => {
      if (sql.includes("INSERT INTO sync_outbox")) encolados.push(params);
    },
    withTransactionAsync: async (fn: () => Promise<void>) => fn(),
  };
  return { db: db as any, encolados, consultas };
}

describe("encolarUsuariosSinRegistrarEnErp", () => {
  it("encola el alta de cada usuario pendiente con su MISMO id y su sucursal", async () => {
    const { db, encolados } = baseFalsa([
      { id: "u-1", nombre: "Ana", rol: "CAJERO", sucursal_id: "suc-1" },
      { id: "u-2", nombre: "Luis", rol: "ADMIN_SUCURSAL", sucursal_id: "suc-1" },
    ]);
    expect(await encolarUsuariosSinRegistrarEnErp(db)).toBe(2);

    // Columnas: local_id, entidad, operacion, entidad_id, idempotency_key, sucursal_id, dispositivo_id, usuario_id, payload, …
    const [, entidad, operacion, entidadId, , sucursalId, , , payload] = encolados[0];
    expect(entidad).toBe(SyncEntidad.USUARIO);
    expect(operacion).toBe(SyncOperacion.CREATE);
    expect(entidadId).toBe("u-1");
    expect(sucursalId).toBe("suc-1");
    expect(JSON.parse(payload)).toEqual({ nombre: "Ana", rol: "CAJERO" });
  });

  it("el PIN nunca viaja en el payload", async () => {
    const { db, encolados } = baseFalsa([{ id: "u-1", nombre: "Ana", rol: "CAJERO", sucursal_id: "suc-1" }]);
    await encolarUsuariosSinRegistrarEnErp(db);
    expect(encolados[0][8]).not.toMatch(/pin|hash|salt/i);
  });

  it("se salta a quien ya tiene su alta en la cola (idempotente en cada arranque)", async () => {
    const { db, consultas } = baseFalsa([]);
    expect(await encolarUsuariosSinRegistrarEnErp(db)).toBe(0);
    expect(consultas[0]).toMatch(/NOT EXISTS \(SELECT 1 FROM sync_outbox/);
    expect(consultas[0]).toMatch(/erp_usuario_id IS NULL/);
  });
});
