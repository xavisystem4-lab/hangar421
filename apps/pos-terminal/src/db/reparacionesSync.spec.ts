import { altasARepuntar, repuntarAltasDeUsuarioSinAcceso } from "./reparacionesSync";

jest.mock("./dispositivoLocal", () => ({ obtenerSucursalErp: jest.fn(async () => "suc-mecanicos") }));
jest.mock("./multisucursalRepo", () => ({
  listarSucursalesTerminal: jest.fn(async () => [{ id: "suc-mecanicos", nombre: "Mecánicos" }, { id: "suc-bj", nombre: "Benito Juárez" }]),
}));

const SIN_ACCESO = "No tienes acceso a esta sucursal";

describe("altasARepuntar", () => {
  const filas = [
    { localId: "o1", usuarioId: "u1", sucursalId: "suc-vieja", ultimoError: SIN_ACCESO },
    { localId: "o2", usuarioId: "u2", sucursalId: "suc-bj", ultimoError: SIN_ACCESO },
    { localId: "o3", usuarioId: "u3", sucursalId: "suc-vieja", ultimoError: "Otro error" },
  ];

  it("solo mueve las rechazadas por acceso cuya sucursal ya no es de la terminal", () => {
    expect(altasARepuntar(filas, ["suc-mecanicos", "suc-bj"]).map((f) => f.localId)).toEqual(["o1"]);
  });

  it("nunca mueve a alguien de una sucursal válida de la terminal", () => {
    expect(altasARepuntar(filas, ["suc-mecanicos", "suc-bj", "suc-vieja"])).toEqual([]);
  });
});

describe("repuntarAltasDeUsuarioSinAcceso", () => {
  it("pasa el alta y el usuario local a la sucursal activa y lo devuelve a la cola", async () => {
    const escrituras: { sql: string; params: any[] }[] = [];
    const db: any = {
      getAllAsync: async () => [
        { local_id: "o1", entidad_id: "u1", sucursal_id: "suc-vieja", ultimo_error: SIN_ACCESO },
        { local_id: "o2", entidad_id: "u2", sucursal_id: "suc-bj", ultimo_error: SIN_ACCESO },
      ],
      runAsync: async (sql: string, ...params: any[]) => { escrituras.push({ sql, params }); },
      withTransactionAsync: async (fn: () => Promise<void>) => fn(),
    };

    await expect(repuntarAltasDeUsuarioSinAcceso(db)).resolves.toBe(1);
    expect(escrituras).toEqual([
      { sql: expect.stringContaining("UPDATE sync_outbox SET sucursal_id = ?, estado = 'PENDING'"), params: ["suc-mecanicos", "o1"] },
      { sql: expect.stringContaining("UPDATE usuarios_locales SET sucursal_id = ?"), params: ["suc-mecanicos", "u1", "suc-vieja"] },
    ]);
  });
});
