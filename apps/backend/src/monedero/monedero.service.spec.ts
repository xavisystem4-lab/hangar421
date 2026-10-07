import { BadRequestException, NotFoundException } from "@nestjs/common";
import { MonederoService, claveEmpleada, unicosPorNombre } from "./monedero.service";

function crearServicio() {
  const prisma = {
    usuario: { findUnique: jest.fn(({ where: { id } }: any) => Promise.resolve(id === "u-diana" ? { empresaId: "emp-1" } : id === "u-ajena" ? { empresaId: "otra-empresa" } : null)) },
    sucursal: { findUnique: jest.fn(({ where: { id } }: any) => Promise.resolve(id === "suc-mec" ? { empresaId: "emp-1" } : null)) },
    monederoEmpleado: { upsert: jest.fn((args: any) => Promise.resolve(args.create)), findMany: jest.fn(() => Promise.resolve([])) },
    movimientoMonedero: { findMany: jest.fn(() => Promise.resolve([])) },
  };
  return { service: new MonederoService(prisma as any), prisma };
}

describe("MonederoService.configurar", () => {
  it("da de alta con el tope de $500 por defecto y su día/hora de reinicio", async () => {
    const { service, prisma } = crearServicio();
    await service.configurar("emp-1", "u-diana", { diaReinicio: 5, horaReinicio: 21, sucursalId: "suc-mec" });

    expect((prisma.monederoEmpleado.upsert.mock.calls[0] as any[])[0].create).toMatchObject({
      usuarioId: "u-diana", empresaId: "emp-1", limite: 500, diaReinicio: 5, horaReinicio: 21, minutoReinicio: 0, activo: true, sucursalId: "suc-mec",
    });
  });

  it.each([
    [{ diaReinicio: 7, horaReinicio: 21 }, "día"],
    [{ diaReinicio: 5, horaReinicio: 24 }, "hora"],
    [{ diaReinicio: 5, horaReinicio: 21, minutoReinicio: 60 }, "minuto"],
    [{ diaReinicio: 5, horaReinicio: 21, limite: 0 }, "límite"],
  ])("rechaza datos inválidos (%j → %s)", async (dto: any, _campo: string) => {
    const { service } = crearServicio();
    await expect(service.configurar("emp-1", "u-diana", dto as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("no deja configurar un usuario de otra empresa ni uno que no existe", async () => {
    const { service } = crearServicio();
    await expect(service.configurar("emp-1", "u-ajena", { diaReinicio: 5, horaReinicio: 21 })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.configurar("emp-1", "nadie", { diaReinicio: 5, horaReinicio: 21 })).rejects.toBeInstanceOf(NotFoundException);
  });

  it("rechaza una sucursal que no es de la empresa", async () => {
    const { service } = crearServicio();
    await expect(service.configurar("emp-1", "u-diana", { diaReinicio: 5, horaReinicio: 21, sucursalId: "suc-ajena" })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("un solo monedero por empleada", () => {
  const mon = (usuarioId: string, nombre: string, sucursalId: string | null, desde: string, asignadoA: string[] = []) => ({
    usuarioId, sucursalId, usuario: { nombre, createdAt: new Date(desde), sucursales: asignadoA.map((s) => ({ sucursalId: s })) },
  });

  it("claveEmpleada ignora apellido, mayúsculas y acentos", () => {
    expect(claveEmpleada("  Dánïela  Pérez ")).toBe("daniela");
    expect(claveEmpleada("DIANA")).toBe("diana");
  });

  it("deja el monedero de su sucursal; si no, el usuario más antiguo", () => {
    const lista = [
      mon("diana-bj", "Diana", "suc-mec", "2025-01-01", ["suc-bj"]),
      mon("diana-mec", "Diana", "suc-mec", "2025-06-01", ["suc-mec"]),
      mon("andrea-1", "Andrea", null, "2025-03-01"),
      mon("andrea-2", "Andrea", null, "2025-02-01"),
      mon("dalia", "Dalia", "suc-bj", "2025-01-01", ["suc-bj"]),
    ];
    expect(unicosPorNombre(lista).map((m) => m.usuarioId)).toEqual(["diana-mec", "andrea-2", "dalia"]);
  });

  it("paraTerminal manda un monedero por nombre aunque haya dos activos", async () => {
    const { service, prisma } = crearServicio();
    const fila = (usuarioId: string, sucursalId: string, desde: string, asignado: string) => ({
      usuarioId, sucursalId, limite: 500, diaReinicio: 5, horaReinicio: 21, minutoReinicio: 0,
      usuario: { nombre: "Diana", createdAt: new Date(desde), sucursales: [{ sucursalId: asignado }] }, sucursal: { nombre: "Mecánicos" },
    });
    prisma.monederoEmpleado.findMany.mockResolvedValueOnce([fila("d-bj", "suc-mec", "2025-01-01", "suc-bj"), fila("d-mec", "suc-mec", "2025-06-01", "suc-mec")] as any);
    const r = await service.paraTerminal("emp-1");
    expect(r.monederos.map((m) => m.usuarioId)).toEqual(["d-mec"]);
  });

  it("rechaza activar un segundo monedero con el mismo nombre", async () => {
    const { service, prisma } = crearServicio();
    (prisma.usuario.findUnique as jest.Mock).mockResolvedValueOnce({ empresaId: "emp-1", nombre: "Diana" });
    prisma.monederoEmpleado.findMany.mockResolvedValueOnce([{ usuarioId: "otra-diana", usuario: { nombre: "Diana López" } }] as any);
    await expect(service.configurar("emp-1", "u-diana", { diaReinicio: 5, horaReinicio: 21 })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.monederoEmpleado.upsert).not.toHaveBeenCalled();
  });

  it("sí deja apagarlo aunque exista otro activo con el mismo nombre", async () => {
    const { service, prisma } = crearServicio();
    await service.configurar("emp-1", "u-diana", { diaReinicio: 5, horaReinicio: 21, activo: false });
    expect(prisma.monederoEmpleado.upsert).toHaveBeenCalled();
  });
});
