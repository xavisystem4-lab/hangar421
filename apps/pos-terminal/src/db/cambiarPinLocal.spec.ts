jest.mock("../auth/offlineAuth", () => ({
  generarSalt: jest.fn(async () => "sal"),
  derivarHashPin: jest.fn(async (pin: string, salt: string) => `${salt}:${pin}`),
  algoritmoHashActual: "sha256",
}));
jest.mock("./dispositivoLocal", () => ({ obtenerOCrearDispositivoId: jest.fn(async () => "disp"), obtenerOCrearSucursalIdLocal: jest.fn(async () => "suc-mec") }));
jest.mock("./outboxRepo", () => ({ encolarSync: jest.fn() }));

import { cambiarPinLocal } from "./usuariosLocalesRepo";

function baseFalsa(filas: { locales?: any[]; pines?: any[]; erp?: any[] } = {}) {
  const ejecutados: { sql: string; params: any[] }[] = [];
  return {
    ejecutados,
    db: {
      getAllAsync: jest.fn(async () => filas.pines ?? []),
      getFirstAsync: jest.fn(async (sql: string, id: string) =>
        sql.includes("FROM usuarios_locales") ? (filas.locales ?? []).find((l) => l.id === id) ?? null
          : sql.includes("FROM usuarios_erp") ? (filas.erp ?? []).find((e) => e.id === id) ?? null
            : null),
      runAsync: jest.fn(async (sql: string, ...params: any[]) => { ejecutados.push({ sql, params }); }),
      withTransactionAsync: jest.fn(async (fn: any) => fn()),
    } as any,
  };
}

describe("cambiarPinLocal", () => {
  it("guarda el PIN nuevo de alguien que ya está en la tablet", async () => {
    const { db, ejecutados } = baseFalsa({ locales: [{ id: "u-dani" }] });
    await cambiarPinLocal(db, "u-dani", "2026");
    const pin = ejecutados.find((e) => e.sql.includes("INSERT INTO pin_cache"))!;
    expect(pin.params.slice(0, 3)).toEqual(["u-dani", "sal:2026", "sal"]);
  });

  it("da de alta en la tablet a una persona del ERP que nunca había entrado", async () => {
    const { db, ejecutados } = baseFalsa({ erp: [{ id: "u-dani", nombre: "Daniela Ramírez" }] });
    await cambiarPinLocal(db, "u-dani", "2026");
    const alta = ejecutados.find((e) => e.sql.includes("INSERT INTO usuarios_locales"))!;
    expect(alta.params.slice(0, 5)).toEqual(["u-dani", "suc-mec", "Daniela Ramírez", "CAJERO", "u-dani"]);
  });

  it("rechaza un PIN inválido o que ya usa otra persona", async () => {
    await expect(cambiarPinLocal(baseFalsa({ locales: [{ id: "u" }] }).db, "u", "12")).rejects.toThrow(/4 a 6/);
    const { db } = baseFalsa({ locales: [{ id: "u" }], pines: [{ id: "otra", nombre: "Andrea", hash_local: "s:2026", salt: "s" }] });
    await expect(cambiarPinLocal(db, "u", "2026")).rejects.toThrow(/Andrea/);
  });
});
