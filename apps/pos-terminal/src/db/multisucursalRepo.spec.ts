import {
  adoptarUsuarioErp,
  aplicarPreciosDeSucursal,
  guardarAlcanceTerminal,
  sucursalesDelUsuario,
  usuariosParaLogin,
} from "./multisucursalRepo";

// Base falsa (ver migracionSucursal.spec.ts): expo-sqlite no corre bajo Jest. Responde por tipo
// de consulta con datos fijos y registra las escrituras; lo que se prueba es la lógica que decide
// qué se ofrece y qué se guarda.
function baseFalsa(datos: {
  sucursales?: { id: string; nombre: string }[];
  locales?: { id: string; nombre: string; rol: string; sucursal_id?: string }[];
  erp?: { id: string; nombre: string; rol: string }[];
  asignadas?: Record<string, { id: string; nombre: string }[]>;
} = {}) {
  const escrituras: { sql: string; params: any[] }[] = [];
  const db = {
    getAllAsync: async (sql: string, ...params: any[]) => {
      if (sql.includes("FROM sucursales_terminal ORDER BY")) return datos.sucursales ?? [];
      // Antes que usuarios_locales: la consulta del ERP la menciona en su subconsulta NOT IN.
      if (sql.includes("FROM usuarios_erp")) return datos.erp ?? [];
      if (sql.includes("FROM usuarios_locales")) return datos.locales ?? [];
      if (sql.includes("FROM usuarios_sucursales us JOIN sucursales_terminal")) return datos.asignadas?.[params[0]] ?? [];
      return [];
    },
    getFirstAsync: async (sql: string, ...params: any[]) => {
      if (sql.includes("SELECT sucursal_id FROM usuarios_locales")) {
        const u = datos.locales?.find((l) => l.id === params[0]);
        return u ? { sucursal_id: u.sucursal_id } : null;
      }
      return null;
    },
    runAsync: async (sql: string, ...params: any[]) => {
      escrituras.push({ sql, params });
    },
    withTransactionAsync: async (fn: () => Promise<void>) => fn(),
  };
  return { db: db as any, escrituras };
}

const MEC = { id: "suc-mec", nombre: "Mecánicos" };
const BJ = { id: "suc-bj", nombre: "Benito Juárez" };

describe("usuariosParaLogin", () => {
  it("en una terminal de una sola sucursal devuelve null (se usa la lista de siempre)", async () => {
    const { db } = baseFalsa({ sucursales: [] });
    expect(await usuariosParaLogin(db)).toBeNull();
  });

  it("junta los usuarios de la tablet con los del ERP que aún no entraron aquí, marcando estos", async () => {
    const { db } = baseFalsa({
      sucursales: [MEC, BJ],
      locales: [{ id: "u-ana", nombre: "Ana", rol: "CAJERO" }],
      erp: [{ id: "u-luis", nombre: "Luis", rol: "SUPERVISOR" }],
    });
    expect(await usuariosParaLogin(db)).toEqual([
      { id: "u-ana", nombre: "Ana", rol: "CAJERO", requiereConexion: false },
      { id: "u-luis", nombre: "Luis", rol: "SUPERVISOR", requiereConexion: true },
    ]);
  });
});

describe("sucursalesDelUsuario", () => {
  it("ofrece solo las sucursales que el ERP le asignó y que la terminal tiene", async () => {
    const { db } = baseFalsa({ sucursales: [MEC, BJ], asignadas: { "u-ana": [BJ, MEC] } });
    expect(await sucursalesDelUsuario(db, "u-ana")).toEqual([BJ, MEC]);
  });

  it("un usuario creado en la tablet que aún no está en el ERP opera en su sucursal de alta", async () => {
    const { db } = baseFalsa({ sucursales: [MEC, BJ], locales: [{ id: "u-nuevo", nombre: "Nuevo", rol: "CAJERO", sucursal_id: "suc-bj" }] });
    expect(await sucursalesDelUsuario(db, "u-nuevo")).toEqual([BJ]);
  });

  it("en una terminal de una sola sucursal no hay nada que elegir", async () => {
    const { db } = baseFalsa({ sucursales: [] });
    expect(await sucursalesDelUsuario(db, "u-ana")).toEqual([]);
  });
});

describe("adoptarUsuarioErp (primera entrada, ya validada en línea)", () => {
  it("lo guarda con su MISMO id, su hash local de PIN y sus sucursales", async () => {
    const { db, escrituras } = baseFalsa();
    await adoptarUsuarioErp(db, { id: "u-luis", nombre: "Luis", sucursales: [{ sucursalId: "suc-mec", rol: "SUPERVISOR" }, { sucursalId: "suc-bj", rol: "CAJERO" }] }, "4321");

    const alta = escrituras.find((e) => e.sql.includes("INSERT INTO usuarios_locales"))!;
    expect(alta.params.slice(0, 5)).toEqual(["u-luis", "suc-mec", "Luis", "SUPERVISOR", "u-luis"]);
    const pin = escrituras.find((e) => e.sql.includes("INSERT INTO pin_cache"))!;
    expect(pin.params).not.toContain("4321");
    expect(escrituras.filter((e) => e.sql.includes("usuarios_sucursales")).map((e) => e.params)).toEqual([
      ["u-luis", "suc-mec", "SUPERVISOR"],
      ["u-luis", "suc-bj", "CAJERO"],
    ]);
    // Ya existe en el ERP: no se encola su alta.
    expect(escrituras.some((e) => e.sql.includes("sync_outbox"))).toBe(false);
  });

  it("sin sucursales en esta terminal no se adopta", async () => {
    const { db } = baseFalsa();
    await expect(adoptarUsuarioErp(db, { id: "u-x", nombre: "X", sucursales: [] }, "1234")).rejects.toThrow();
  });
});

describe("precios y alcance", () => {
  it("aplicar precios solo toca productos con precio para esa sucursal", async () => {
    const { db, escrituras } = baseFalsa();
    await aplicarPreciosDeSucursal(db, "suc-bj");
    expect(escrituras[0].sql).toMatch(/WHERE id IN \(SELECT producto_id FROM precios_sucursal WHERE sucursal_id = \?\)/);
    expect(escrituras[0].params).toEqual(["suc-bj", "suc-bj", "suc-bj"]);
  });

  it("volver a una terminal de una sola sucursal borra el contexto multisucursal", async () => {
    const { db, escrituras } = baseFalsa();
    await guardarAlcanceTerminal(db, "SUCURSAL");
    const borradas = escrituras.filter((e) => e.sql.startsWith("DELETE FROM")).map((e) => e.sql.replace("DELETE FROM ", ""));
    expect(borradas).toEqual(["sucursales_terminal", "usuarios_erp", "usuarios_sucursales", "precios_sucursal"]);
  });
});
