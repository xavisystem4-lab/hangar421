import { BadRequestException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { UsuariosService } from "./usuarios.service";

/** El PIN es personal: Dalia no puede tener el mismo PIN que Diana (abrió caja como Diana). */
describe("PIN personal único", () => {
  async function servicio(otros: { nombre: string; pin: string }[]) {
    const filas = await Promise.all(otros.map(async (o) => ({ nombre: o.nombre, pinHash: await bcrypt.hash(o.pin, 4) })));
    const prisma = {
      usuario: {
        findMany: jest.fn(() => Promise.resolve(filas)),
        findUnique: jest.fn(() => Promise.resolve({ empresaId: "emp", nombre: "Dalia", sucursales: [{ sucursalId: "mec" }] })),
        update: jest.fn((a: any) => Promise.resolve(a)),
        create: jest.fn((a: any) => Promise.resolve(a)),
      },
    };
    return { service: new UsuariosService(prisma as any), prisma };
  }

  it("rechaza un PIN que ya usa otra persona", async () => {
    const { service, prisma } = await servicio([{ nombre: "Diana Pérez", pin: "1234" }]);
    await expect(service.actualizarPin("u-dalia", "1234")).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.usuario.update).not.toHaveBeenCalled();
  });

  it("acepta un PIN distinto", async () => {
    const { service, prisma } = await servicio([{ nombre: "Diana Pérez", pin: "1234" }]);
    await service.actualizarPin("u-dalia", "5678");
    expect(prisma.usuario.update).toHaveBeenCalled();
  });

  it("la misma persona (otro usuario suyo en otra sucursal) sí puede repetir su PIN", async () => {
    const { service } = await servicio([{ nombre: "Dalia", pin: "1234" }]);
    await expect(service.actualizarPin("u-dalia", "1234")).resolves.toBeDefined();
  });

  it("también al dar de alta", async () => {
    const { service } = await servicio([{ nombre: "Diana", pin: "1234" }]);
    await expect(
      service.crear({ empresaId: "emp", nombre: "Dalia", username: "dalia", pin: "1234", sucursales: [{ sucursalId: "mec", rol: "CAJERO" as any }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
