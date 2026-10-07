import { BadRequestException, NotFoundException } from "@nestjs/common";
import { MonederoService } from "./monedero.service";

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
