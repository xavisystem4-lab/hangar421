import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { RolUsuario } from "@hangar421/shared";
import { VinculacionService } from "./vinculacion.service";

/** Prisma falso: solo lo que toca este servicio. Se guardan las llamadas para poder afirmar
 *  sobre el UPDATE condicional del canje, que es lo que garantiza el "un solo uso". */
function crearPrisma(overrides: any = {}) {
  const estado = {
    codigo: null as any,
    updateManyWhere: null as any,
    usuarioCreado: null as any,
    dispositivoUpsert: null as any,
  };
  const prisma: any = {
    sucursal: {
      findFirst: jest.fn(async () => ({ id: "suc-1", nombre: "Roma Norte", empresaId: "emp-1", activo: true })),
      findUniqueOrThrow: jest.fn(async () => ({ id: "suc-1", nombre: "Roma Norte" })),
    },
    codigoVinculacion: {
      create: jest.fn(async ({ data }: any) => {
        estado.codigo = data;
        return { id: "cod-1", ...data };
      }),
      findUnique: jest.fn(async () => estado.codigo),
      updateMany: jest.fn(async ({ where }: any) => {
        estado.updateManyWhere = where;
        return { count: 1 };
      }),
    },
    usuario: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => {
        estado.usuarioCreado = data;
        return { id: "usr-terminal", nombre: data.nombre };
      }),
    },
    usuarioSucursal: { upsert: jest.fn(async () => ({})) },
    dispositivo: {
      upsert: jest.fn(async (args: any) => {
        estado.dispositivoUpsert = args;
        return {};
      }),
    },
    ...overrides,
  };
  return { prisma, estado };
}

const auth: any = {
  emitirSesionParaTerminal: jest.fn(async () => ({ accessToken: "acc", refreshToken: "ref" })),
};

describe("VinculacionService.crear", () => {
  it("genera un código de 8 caracteres del alfabeto sin ambigüedades", async () => {
    const { prisma } = crearPrisma();
    const servicio = new VinculacionService(prisma, auth);
    const { codigo } = await servicio.crear({ empresaId: "emp-1", sucursalId: "suc-1", creadoPorId: "admin-1" });

    expect(codigo).toHaveLength(8);
    // Sin O/0, I/1/L ni U: se dicta por teléfono y se teclea en una tablet.
    expect(codigo).toMatch(/^[ABCDEFGHJKMNPQRSTVWXYZ23456789]{8}$/);
  });

  it("no repite el mismo código dos veces seguidas", async () => {
    const { prisma } = crearPrisma();
    const servicio = new VinculacionService(prisma, auth);
    const a = await servicio.crear({ empresaId: "emp-1", sucursalId: "suc-1", creadoPorId: "admin-1" });
    const b = await servicio.crear({ empresaId: "emp-1", sucursalId: "suc-1", creadoPorId: "admin-1" });
    expect(a.codigo).not.toBe(b.codigo);
  });

  it("caduca a los 15 minutos", async () => {
    const { prisma } = crearPrisma();
    const servicio = new VinculacionService(prisma, auth);
    const { expiraAt } = await servicio.crear({ empresaId: "emp-1", sucursalId: "suc-1", creadoPorId: "admin-1" });
    const minutos = (expiraAt.getTime() - Date.now()) / 60_000;
    expect(minutos).toBeGreaterThan(14);
    expect(minutos).toBeLessThanOrEqual(15);
  });

  it("usa CAJERO por defecto — una terminal nunca necesita más", async () => {
    const { prisma, estado } = crearPrisma();
    const servicio = new VinculacionService(prisma, auth);
    await servicio.crear({ empresaId: "emp-1", sucursalId: "suc-1", creadoPorId: "admin-1" });
    expect(estado.codigo.rol).toBe(RolUsuario.CAJERO);
  });

  // EmpresaScopeGuard compara el empresaId declarado contra el del token, pero no que la
  // sucursal pertenezca a esa empresa: sin esta comprobación un admin emitiría códigos hacia
  // la sucursal de otra empresa.
  it("rechaza una sucursal que no es de la empresa de quien lo genera", async () => {
    const { prisma } = crearPrisma({ sucursal: { findFirst: jest.fn(async () => null), findUniqueOrThrow: jest.fn() } });
    const servicio = new VinculacionService(prisma, auth);
    await expect(servicio.crear({ empresaId: "emp-1", sucursalId: "suc-de-otra", creadoPorId: "admin-1" }))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("VinculacionService.vincular", () => {
  async function conCodigoValido() {
    const { prisma, estado } = crearPrisma();
    const servicio = new VinculacionService(prisma, auth);
    const { codigo } = await servicio.crear({ empresaId: "emp-1", sucursalId: "suc-1", creadoPorId: "admin-1" });
    estado.codigo = { ...estado.codigo, id: "cod-1", usadoAt: null, sucursal: { nombre: "Roma Norte" } };
    return { servicio, prisma, estado, codigo };
  }

  it("canjea un código válido y devuelve sesión para la sucursal", async () => {
    const { servicio, codigo } = await conCodigoValido();
    const r = await servicio.vincular({ codigo, dispositivoId: "disp-1" });
    expect(r.sucursalId).toBe("suc-1");
    expect(r.sucursal).toBe("Roma Norte");
    expect(r.accessToken).toBe("acc");
  });

  it("acepta el código en minúsculas y con espacios o guiones", async () => {
    const { servicio, codigo } = await conCodigoValido();
    const maquillado = `${codigo.slice(0, 4).toLowerCase()}-${codigo.slice(4).toLowerCase()}`;
    await expect(servicio.vincular({ codigo: maquillado, dispositivoId: "disp-1" })).resolves.toBeDefined();
  });

  // El "un solo uso" se cierra con un UPDATE condicional, no leyendo y luego escribiendo: dos
  // terminales canjeando a la vez deben dejar exactamente una ganadora.
  it("marca el canje con un UPDATE condicionado a que siga sin usar", async () => {
    const { servicio, estado, codigo } = await conCodigoValido();
    await servicio.vincular({ codigo, dispositivoId: "disp-1" });
    expect(estado.updateManyWhere).toEqual({ id: "cod-1", usadoAt: null });
  });

  it("rechaza si otra terminal ganó la carrera", async () => {
    const { servicio, prisma, codigo } = await conCodigoValido();
    prisma.codigoVinculacion.updateMany = jest.fn(async () => ({ count: 0 }));
    await expect(servicio.vincular({ codigo, dispositivoId: "disp-2" })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rechaza un código ya usado", async () => {
    const { servicio, estado, codigo } = await conCodigoValido();
    estado.codigo.usadoAt = new Date();
    await expect(servicio.vincular({ codigo, dispositivoId: "disp-1" })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rechaza un código caducado", async () => {
    const { servicio, estado, codigo } = await conCodigoValido();
    estado.codigo.expiraAt = new Date(Date.now() - 1000);
    await expect(servicio.vincular({ codigo, dispositivoId: "disp-1" })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rechaza un código inexistente", async () => {
    const { prisma } = crearPrisma();
    prisma.codigoVinculacion.findUnique = jest.fn(async () => null);
    const servicio = new VinculacionService(prisma, auth);
    await expect(servicio.vincular({ codigo: "NOEXISTE", dispositivoId: "disp-1" })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  // Distinguir "no existe" de "caducado" le diría a quien prueba códigos al azar cuáles existen.
  it("da el mismo mensaje para inexistente, usado y caducado", async () => {
    const { servicio, estado, codigo } = await conCodigoValido();
    estado.codigo.usadoAt = new Date();
    const usado = await servicio.vincular({ codigo, dispositivoId: "d" }).catch((e) => e.message);

    const { prisma } = crearPrisma();
    prisma.codigoVinculacion.findUnique = jest.fn(async () => null);
    const otro = new VinculacionService(prisma, auth);
    const inexistente = await otro.vincular({ codigo: "NOEXISTE", dispositivoId: "d" }).catch((e) => e.message);

    expect(usado).toBe(inexistente);
  });

  it("exige código y dispositivoId", async () => {
    const { servicio } = await conCodigoValido();
    await expect(servicio.vincular({ codigo: "", dispositivoId: "d" })).rejects.toBeInstanceOf(BadRequestException);
    await expect(servicio.vincular({ codigo: "ABCD2345", dispositivoId: "" })).rejects.toBeInstanceOf(BadRequestException);
  });

  // Sin passwordHash ni pinHash: loginConCredenciales y loginConPin rechazan a quien no los
  // tenga, así que esta identidad solo puede nacer de un canje de código.
  it("crea el usuario-terminal sin contraseña ni PIN", async () => {
    const { servicio, estado, codigo } = await conCodigoValido();
    await servicio.vincular({ codigo, dispositivoId: "disp-1" });
    expect(estado.usuarioCreado.username).toBe("terminal.suc-1");
    expect(estado.usuarioCreado.passwordHash).toBeUndefined();
    expect(estado.usuarioCreado.pinHash).toBeUndefined();
  });

  it("registra la terminal como dispositivo de la sucursal", async () => {
    const { servicio, estado, codigo } = await conCodigoValido();
    await servicio.vincular({ codigo, dispositivoId: "disp-1", nombreDispositivo: "Caja 2" });
    expect(estado.dispositivoUpsert.where).toEqual({ identificador: "disp-1" });
    expect(estado.dispositivoUpsert.create.nombre).toBe("Caja 2");
  });

  // El registro del dispositivo es informativo: un fallo ahí no puede tumbar un canje ya
  // consumido, o el código se perdería sin que la terminal quedara vinculada.
  it("completa la vinculación aunque falle el registro del dispositivo", async () => {
    const { servicio, prisma, codigo } = await conCodigoValido();
    prisma.dispositivo.upsert = jest.fn(async () => {
      throw new Error("fallo de red");
    });
    await expect(servicio.vincular({ codigo, dispositivoId: "disp-1" })).resolves.toBeDefined();
  });
});
