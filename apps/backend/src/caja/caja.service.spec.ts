import { CajaService } from "./caja.service";

/**
 * El caso que rompía en producción: el APK manda `cajaId: null` porque una tablet no es una
 * caja registrada en el ERP. Prisma reventaba con `Argument 'cajaId' must not be null` y el
 * corte se quedaba reintentándose en la cola para siempre.
 *
 * Mocks simples en vez de un TestingModule, igual que sync.service.spec.ts: la lógica a probar
 * no depende de nada de Nest.
 */
function crearServicio(cajasExistentes: { id: string; nombre: string }[] = [], usuarios: string[] = ["user-1"]) {
  const prisma = {
    turno: {
      findFirst: jest.fn(() => Promise.resolve(null)),
      create: jest.fn((args: any) => Promise.resolve({ id: "turno-1", ...args.data })),
    },
    usuario: {
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(usuarios.includes(where.id ?? where.username) ? { id: where.id ?? "terminal-suc-1" } : null),
      ),
      create: jest.fn(() => Promise.resolve({ id: "terminal-creado" })),
    },
    sucursal: {
      findUniqueOrThrow: jest.fn(() => Promise.resolve({ empresaId: "emp-1", nombre: "Colonial" })),
    },
    pedido: { count: jest.fn(() => Promise.resolve(0)) },
    auditLog: { create: jest.fn(() => Promise.resolve({})) },
    $transaction: jest.fn((ops) => Promise.all(ops)),
    caja: {
      findFirst: jest.fn(() => Promise.resolve(cajasExistentes[0] ?? null)),
      create: jest.fn((args: any) => Promise.resolve({ id: "caja-nueva", ...args.data })),
    },
  };
  return { service: new CajaService(prisma as any), prisma };
}

const BASE = { sucursalId: "suc-1", usuarioId: "user-1", montoInicial: 500 };

describe("CajaService.abrirTurno", () => {
  it("usa la caja indicada cuando viene", async () => {
    const { service, prisma } = crearServicio();
    await service.abrirTurno({ ...BASE, cajaId: "caja-explicita" });

    expect(prisma.caja.findFirst).not.toHaveBeenCalled();
    expect(prisma.turno.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ cajaId: "caja-explicita" }) }),
    );
  });

  it("con cajaId null usa la caja activa de la sucursal en vez de reventar", async () => {
    const { service, prisma } = crearServicio([{ id: "caja-existente", nombre: "Caja principal" }]);
    await service.abrirTurno({ ...BASE, cajaId: null });

    expect(prisma.caja.create).not.toHaveBeenCalled();
    expect(prisma.turno.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ cajaId: "caja-existente" }) }),
    );
  });

  it("con cajaId undefined se comporta igual que con null", async () => {
    const { service, prisma } = crearServicio([{ id: "caja-existente", nombre: "Caja principal" }]);
    await service.abrirTurno({ ...BASE });

    expect(prisma.turno.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ cajaId: "caja-existente" }) }),
    );
  });

  it("si la sucursal no tiene ninguna caja, la crea", async () => {
    // Rechazar el corte sería peor: es dinero real ya contado, y que la sucursal no tenga caja
    // dada de alta es una omisión de configuración, no una decisión.
    const { service, prisma } = crearServicio([]);
    await service.abrirTurno({ ...BASE, cajaId: null });

    expect(prisma.caja.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sucursalId: "suc-1", nombre: "Caja principal" }) }),
    );
    expect(prisma.turno.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ cajaId: "caja-nueva" }) }),
    );
  });

  it("sigue rechazando un segundo turno abierto en la misma caja", async () => {
    const { service, prisma } = crearServicio([{ id: "caja-existente", nombre: "Caja principal" }]);
    prisma.turno.findFirst.mockResolvedValueOnce({ id: "turno-ya-abierto" } as any);

    await expect(service.abrirTurno({ ...BASE, cajaId: null })).rejects.toThrow(/turno abierto/i);
    expect(prisma.turno.create).not.toHaveBeenCalled();
  });

  it("comprueba el turno abierto contra la caja RESUELTA, no contra el null recibido", async () => {
    const { service, prisma } = crearServicio([{ id: "caja-existente", nombre: "Caja principal" }]);
    await service.abrirTurno({ ...BASE, cajaId: null });

    expect(prisma.turno.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ cajaId: "caja-existente" }) }),
    );
  });
});

/**
 * Segundo fallo, que solo apareció al arreglar el primero: con la caja ya resuelta, el turno
 * llegaba a insertarse y chocaba con `turnos_usuarioId_fkey`. A diferencia del cobro, aquí NO
 * vale dejar el campo vacío: `Turno.usuarioId` es obligatorio en el esquema.
 */
const CAJA = [{ id: "caja-existente", nombre: "Caja principal" }];

describe("CajaService.abrirTurno — usuario que no existe en el ERP", () => {
  it("conserva el usuario cuando sí existe", async () => {
    const { service, prisma } = crearServicio(CAJA, ["user-1"]);
    await service.abrirTurno({ ...BASE, cajaId: null });

    expect(prisma.turno.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ usuarioId: "user-1" }) }),
    );
  });

  it("cae al usuario-terminal de la sucursal si el cajero no existe", async () => {
    // Cajero dado de alta en la tablet sin conexión: su id es un uuid7 que el ERP nunca ha visto.
    const { service, prisma } = crearServicio(CAJA, ["terminal.suc-1"]);
    await service.abrirTurno({ ...BASE, usuarioId: "01a0bed8-c5d4-7cf0-976e-6dc90afffa6d", cajaId: null });

    expect(prisma.usuario.create).not.toHaveBeenCalled();
    expect(prisma.turno.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ usuarioId: "terminal-suc-1" }) }),
    );
  });

  it("busca el usuario-terminal por la convención de username de VinculacionService", async () => {
    // Si esta convención se desincroniza, se crearían DOS identidades para la misma terminal.
    const { service, prisma } = crearServicio(CAJA, ["terminal.suc-1"]);
    await service.abrirTurno({ ...BASE, usuarioId: "no-existe", cajaId: null });

    expect(prisma.usuario.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { username: "terminal.suc-1" } }),
    );
  });

  it("crea el usuario-terminal si la sucursal todavía no tiene uno", async () => {
    const { service, prisma } = crearServicio(CAJA, []);
    await service.abrirTurno({ ...BASE, usuarioId: "no-existe", cajaId: null });

    expect(prisma.usuario.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ username: "terminal.suc-1", empresaId: "emp-1" }) }),
    );
    expect(prisma.turno.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ usuarioId: "terminal-creado" }) }),
    );
  });

  it("sin usuarioId también resuelve, en vez de insertar un turno sin dueño", async () => {
    const { service, prisma } = crearServicio(CAJA, ["terminal.suc-1"]);
    await service.abrirTurno({ ...BASE, usuarioId: null, cajaId: null });

    expect(prisma.turno.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ usuarioId: "terminal-suc-1" }) }),
    );
  });
});

/**
 * Relevo de cajero con la caja abierta.
 *
 * Solo es seguro porque las ventas se enlazan al turno por `pedidos.turnoId`: cambiar el
 * responsable NO mueve qué ventas pertenecen al turno. Antes de esa columna, el corte deducía
 * sus ventas comparando `cajeroId` con el dueño del turno, así que reasignarlo habría
 * reescrito el arqueo retroactivamente.
 */
function servicioConTurno(turno: any, usuarios: string[] = ["cajero-a", "cajero-b"]) {
  const prisma = {
    turno: {
      findUnique: jest.fn(() => Promise.resolve(turno)),
      update: jest.fn((args: any) => Promise.resolve({ ...turno, ...args.data })),
      findFirst: jest.fn(() => Promise.resolve(null)),
    },
    usuario: {
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(usuarios.includes(where.id ?? where.username) ? { id: where.id ?? "terminal" } : null),
      ),
      create: jest.fn(() => Promise.resolve({ id: "terminal-creado" })),
    },
    sucursal: { findUniqueOrThrow: jest.fn(() => Promise.resolve({ empresaId: "emp-1", nombre: "Colonial" })) },
    auditLog: { create: jest.fn(() => Promise.resolve({})) },
    $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
  };
  return { service: new CajaService(prisma as any), prisma };
}

const TURNO_ABIERTO = { id: "turno-1", sucursalId: "suc-1", usuarioId: "cajero-a", estado: "ABIERTO" };

describe("CajaService.reasignarTurno", () => {
  it("cambia el responsable del turno", async () => {
    const { service, prisma } = servicioConTurno(TURNO_ABIERTO);
    await service.reasignarTurno("turno-1", { nuevoUsuarioId: "cajero-b", autorizadoPorId: "supervisor-1" });

    expect(prisma.turno.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "turno-1" }, data: { usuarioId: "cajero-b" } }),
    );
  });

  it("deja rastro en la auditoría con quién lo tenía antes y quién lo autorizó", async () => {
    const { service, prisma } = servicioConTurno(TURNO_ABIERTO);
    await service.reasignarTurno("turno-1", { nuevoUsuarioId: "cajero-b", autorizadoPorId: "supervisor-1", motivo: "Cambio de turno" });

    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entidad: "TURNO",
          accion: "REASIGNAR",
          usuarioId: "supervisor-1",
          datosAnteriores: { usuarioId: "cajero-a" },
        }),
      }),
    );
  });

  it("rechaza reasignar un turno ya cerrado", async () => {
    // El corte está firmado: cambiar de responsable después reescribiría de quién era el dinero.
    const { service, prisma } = servicioConTurno({ ...TURNO_ABIERTO, estado: "CERRADO" });

    await expect(
      service.reasignarTurno("turno-1", { nuevoUsuarioId: "cajero-b" }),
    ).rejects.toThrow(/ya está cerrado/i);
    expect(prisma.turno.update).not.toHaveBeenCalled();
  });

  it("es idempotente: reenviar el mismo lote no vuelve a auditar", async () => {
    const { service, prisma } = servicioConTurno(TURNO_ABIERTO);
    await service.reasignarTurno("turno-1", { nuevoUsuarioId: "cajero-a" });

    expect(prisma.turno.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("falla claro si el turno no existe", async () => {
    const { service } = servicioConTurno(null);
    await expect(service.reasignarTurno("no-existe", { nuevoUsuarioId: "cajero-b" })).rejects.toThrow(/no encontrado/i);
  });

  it("un cajero desconocido cae al usuario-terminal, no revienta", async () => {
    const { service, prisma } = servicioConTurno(TURNO_ABIERTO, ["cajero-a", "terminal.suc-1"]);
    await service.reasignarTurno("turno-1", { nuevoUsuarioId: "uuid-de-la-tablet" });

    expect(prisma.turno.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { usuarioId: "terminal" } }),
    );
  });
});
