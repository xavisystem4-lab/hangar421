import { turnoPendienteDeDiaAnterior } from "./turnosRepo";

// Base falsa (ver migracionSucursal.spec.ts): responde por tipo de consulta. Lo que se prueba es
// la decisión y el armado del aviso, no el SQL.
function baseFalsa(turno: any | null, config: Record<string, string> = { sucursal_id_erp: "suc-1", sucursal_nombre: "Mecánicos" }) {
  const db = {
    getFirstAsync: async (sql: string, ...params: any[]) => {
      if (sql.includes("FROM config_local")) return config[params[0]] ? { valor: config[params[0]] } : null;
      if (sql.includes("FROM turnos")) return turno;
      if (sql.includes("FROM usuarios_locales")) return params[0] === "u-ana" ? { nombre: "Ana" } : null;
      return null;
    },
    runAsync: async () => undefined,
  };
  return db as any;
}

const hoy8am = new Date(2026, 8, 21, 8, 0);
const fila = (abierto: Date) => ({
  id: "t-1", usuario_id: "u-ana", monto_inicial: 500, monto_final_declarado: null, estado: "ABIERTO", abierto_at: abierto.toISOString(), cerrado_at: null,
});

describe("turnoPendienteDeDiaAnterior", () => {
  it("avisa del turno abierto anoche con responsable y sucursal", async () => {
    const aviso = await turnoPendienteDeDiaAnterior(baseFalsa(fila(new Date(2026, 8, 20, 22, 0))), hoy8am);
    expect(aviso).toMatchObject({ responsable: "Ana", sucursal: "Mecánicos", turno: { id: "t-1" } });
  });

  it("no avisa si el turno abierto es de hoy", async () => {
    expect(await turnoPendienteDeDiaAnterior(baseFalsa(fila(new Date(2026, 8, 21, 7, 0))), hoy8am)).toBeNull();
  });

  it("no avisa si no hay turno abierto", async () => {
    expect(await turnoPendienteDeDiaAnterior(baseFalsa(null), hoy8am)).toBeNull();
  });

  it("si el responsable ya no está en la tablet, avisa igual sin nombre", async () => {
    const aviso = await turnoPendienteDeDiaAnterior(baseFalsa({ ...fila(new Date(2026, 8, 19, 9, 0)), usuario_id: "u-borrado" }), hoy8am);
    expect(aviso?.responsable).toBe("Usuario desconocido");
  });
});
