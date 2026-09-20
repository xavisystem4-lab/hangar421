import { ROLES_AUTORIZAN, autorizarConPin, listarAutorizadores } from "./autorizacion";
import { derivarHashPin, generarSalt } from "./offlineAuth";

/** Base falsa con usuarios_locales + pin_cache, sin expo-sqlite. */
function baseFalsa(usuarios: { id: string; nombre: string; rol: string; hash?: string; salt?: string }[]) {
  const db = {
    getAllAsync: async (sql: string, ...params: any[]) => {
      if (!sql.includes("usuarios_locales")) return [];
      const rolesPedidos = params.slice(1);
      return usuarios
        .filter((u) => u.hash && rolesPedidos.includes(u.rol))
        .map((u) => ({ id: u.id, nombre: u.nombre, rol: u.rol }));
    },
    getFirstAsync: async (sql: string, clave: string) => {
      if (sql.includes("config_local")) return { valor: "suc-1" };
      const u = usuarios.find((x) => x.id === clave);
      return u?.hash ? { hash_local: u.hash, salt: u.salt } : null;
    },
    runAsync: async () => undefined,
  };
  return db as any;
}

async function conPin(pin: string) {
  const salt = await generarSalt();
  return { salt, hash: await derivarHashPin(pin, salt) };
}

describe("ROLES_AUTORIZAN", () => {
  // Si divergiera de ROLES_AUTORIZAN_SUPERVISOR del backend, una cancelación autorizada en la
  // tablet podría ser rechazada al llegar al ERP — y el cajero ya habría devuelto el dinero.
  it("coincide con los roles que autoriza el backend", () => {
    expect([...ROLES_AUTORIZAN].sort()).toEqual(["ADMIN_CORPORATIVO", "ADMIN_SUCURSAL", "SUPERVISOR"]);
  });
});

describe("listarAutorizadores", () => {
  it("solo devuelve usuarios con rol que autoriza", async () => {
    const { salt, hash } = await conPin("1234");
    const db = baseFalsa([
      { id: "cajero", nombre: "Ana", rol: "CAJERO", hash, salt },
      { id: "super", nombre: "Sofía", rol: "SUPERVISOR", hash, salt },
    ]);
    const lista = await listarAutorizadores(db);
    expect(lista.map((a) => a.id)).toEqual(["super"]);
  });

  // Sin PIN en la terminal no puede autorizar offline, por mucho rol que tenga.
  it("excluye a quien no tiene PIN en esta terminal", async () => {
    const db = baseFalsa([{ id: "super", nombre: "Sofía", rol: "SUPERVISOR" }]);
    expect(await listarAutorizadores(db)).toHaveLength(0);
  });
});

describe("autorizarConPin", () => {
  it("autoriza con el PIN correcto y devuelve quién autorizó", async () => {
    const { salt, hash } = await conPin("4321");
    const db = baseFalsa([{ id: "super", nombre: "Sofía", rol: "SUPERVISOR", hash, salt }]);
    const r = await autorizarConPin(db, { autorizadorId: "super", pin: "4321", solicitanteId: "cajero" });
    expect(r.autorizado).toBe(true);
    expect(r.autorizador?.nombre).toBe("Sofía");
  });

  it("rechaza un PIN incorrecto", async () => {
    const { salt, hash } = await conPin("4321");
    const db = baseFalsa([{ id: "super", nombre: "Sofía", rol: "SUPERVISOR", hash, salt }]);
    const r = await autorizarConPin(db, { autorizadorId: "super", pin: "0000", solicitanteId: "cajero" });
    expect(r.autorizado).toBe(false);
    expect(r.error).toBe("PIN incorrecto.");
  });

  // Un cajero no puede autorizarse a sí mismo: no aparece siquiera como autorizador posible.
  it("rechaza a quien no tiene rol de autorización, aunque acierte el PIN", async () => {
    const { salt, hash } = await conPin("1111");
    const db = baseFalsa([{ id: "cajero", nombre: "Ana", rol: "CAJERO", hash, salt }]);
    const r = await autorizarConPin(db, { autorizadorId: "cajero", pin: "1111", solicitanteId: "cajero" });
    expect(r.autorizado).toBe(false);
  });

  // Un gerente trabajando solo sí puede autorizarse: exigirle buscar a otra persona bloquearía
  // la tienda. Queda registrado igual en la auditoría.
  it("permite que un gerente se autorice a sí mismo", async () => {
    const { salt, hash } = await conPin("9999");
    const db = baseFalsa([{ id: "jefe", nombre: "Laura", rol: "ADMIN_SUCURSAL", hash, salt }]);
    const r = await autorizarConPin(db, { autorizadorId: "jefe", pin: "9999", solicitanteId: "jefe" });
    expect(r.autorizado).toBe(true);
  });

  it("rechaza a un usuario que no existe en la terminal", async () => {
    const db = baseFalsa([]);
    const r = await autorizarConPin(db, { autorizadorId: "fantasma", pin: "1234", solicitanteId: "cajero" });
    expect(r.autorizado).toBe(false);
  });

  // El PIN nunca se guarda ni se compara en claro: se deriva y se contrasta contra el hash.
  it("no valida contra el PIN en claro", async () => {
    const salt = await generarSalt();
    const db = baseFalsa([{ id: "super", nombre: "Sofía", rol: "SUPERVISOR", hash: "1234", salt }]);
    const r = await autorizarConPin(db, { autorizadorId: "super", pin: "1234", solicitanteId: "c" });
    expect(r.autorizado).toBe(false);
  });
});
