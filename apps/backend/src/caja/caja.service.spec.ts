import { CajaService } from "./caja.service";

/**
 * El caso que rompía en producción: el APK manda `cajaId: null` porque una tablet no es una
 * caja registrada en el ERP. Prisma reventaba con `Argument 'cajaId' must not be null` y el
 * corte se quedaba reintentándose en la cola para siempre.
 *
 * Mocks simples en vez de un TestingModule, igual que sync.service.spec.ts: la lógica a probar
 * no depende de nada de Nest.
 */
function crearServicio(cajasExistentes: { id: string; nombre: string }[] = []) {
  const prisma = {
    turno: {
      findFirst: jest.fn(() => Promise.resolve(null)),
      create: jest.fn((args: any) => Promise.resolve({ id: "turno-1", ...args.data })),
    },
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
