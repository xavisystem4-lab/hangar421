import { UsuariosService } from "./usuarios.service";

/** SWITCH: intercambiar de sucursal a dos empleadas (o mover a una). */
function crear(opciones: { turnoAbierto?: { usuarioId: string } } = {}) {
  const asignaciones = [
    { id: "as-andrea", usuarioId: "andrea", sucursalId: "mec", rol: "CAJERO", turno: "MATUTINO", perfilId: null, permisosJson: { x: 1 }, activo: true, usuario: { nombre: "Andrea", empresaId: "e1", eliminado: false } },
    { id: "as-diana", usuarioId: "diana", sucursalId: "bj", rol: "CAJERO", turno: "VESPERTINO", perfilId: "p1", permisosJson: {}, activo: true, usuario: { nombre: "Diana", empresaId: "e1", eliminado: false } },
  ];
  const tx = {
    usuarioSucursal: { update: jest.fn(async () => ({})), upsert: jest.fn(async () => ({})) },
    horarioUsuario: { updateMany: jest.fn(async () => ({ count: 1 })) },
    monederoEmpleado: { updateMany: jest.fn(async () => ({ count: 1 })) },
  };
  const prisma: any = {
    sucursal: { findMany: jest.fn(async ({ where }: any) => [{ id: "mec", nombre: "Mecánicos" }, { id: "bj", nombre: "Benito Juárez" }].filter((s) => where.id.in.includes(s.id))) },
    usuarioSucursal: {
      findUnique: jest.fn(async ({ where }: any) => asignaciones.find((a) => a.usuarioId === where.usuarioId_sucursalId.usuarioId && a.sucursalId === where.usuarioId_sucursalId.sucursalId) ?? null),
    },
    turno: { findFirst: jest.fn(async () => (opciones.turnoAbierto ? { ...opciones.turnoAbierto, sucursal: { nombre: "Mecánicos" } } : null)) },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  return { service: new UsuariosService(prisma), tx };
}

describe("switchSucursales", () => {
  it("intercambia a Andrea (Mecánicos) con Diana (Benito Juárez) con sus horarios y crédito", async () => {
    const { service, tx } = crear();
    const r = await service.switchSucursales("e1", { usuarioAId: "andrea", sucursalAId: "mec", usuarioBId: "diana", sucursalBId: "bj" });
    expect(r.movimientos).toEqual(["Andrea: Mecánicos → Benito Juárez", "Diana: Benito Juárez → Mecánicos"]);
    expect(tx.usuarioSucursal.update).toHaveBeenCalledWith({ where: { id: "as-andrea" }, data: { activo: false } });
    expect(tx.usuarioSucursal.update).toHaveBeenCalledWith({ where: { id: "as-diana" }, data: { activo: false } });
    expect(tx.usuarioSucursal.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { usuarioId_sucursalId: { usuarioId: "andrea", sucursalId: "bj" } },
      create: expect.objectContaining({ rol: "CAJERO", turno: "MATUTINO", permisosJson: { x: 1 }, activo: true }),
    }));
    expect(tx.usuarioSucursal.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { usuarioId_sucursalId: { usuarioId: "diana", sucursalId: "mec" } } }));
    expect(tx.horarioUsuario.updateMany).toHaveBeenCalledWith({ where: { usuarioId: "andrea", sucursalId: "mec" }, data: { sucursalId: "bj" } });
    expect(tx.monederoEmpleado.updateMany).toHaveBeenCalledWith({ where: { usuarioId: "diana", sucursalId: "bj" }, data: { sucursalId: "mec" } });
  });

  it("sin segunda persona solo mueve a la primera", async () => {
    const { service, tx } = crear();
    const r = await service.switchSucursales("e1", { usuarioAId: "andrea", sucursalAId: "mec", sucursalBId: "bj" });
    expect(r.movimientos).toEqual(["Andrea: Mecánicos → Benito Juárez"]);
    expect(tx.usuarioSucursal.update).toHaveBeenCalledTimes(1);
  });

  it("no permite cambiar a alguien con turno de caja abierto", async () => {
    const { service, tx } = crear({ turnoAbierto: { usuarioId: "andrea" } });
    await expect(service.switchSucursales("e1", { usuarioAId: "andrea", sucursalAId: "mec", usuarioBId: "diana", sucursalBId: "bj" })).rejects.toThrow("turno de caja abierto");
    expect(tx.usuarioSucursal.update).not.toHaveBeenCalled();
  });

  it("valida sucursales distintas, personas distintas y que estén activas donde se dice", async () => {
    const { service } = crear();
    await expect(service.switchSucursales("e1", { usuarioAId: "andrea", sucursalAId: "mec", sucursalBId: "mec" })).rejects.toThrow("distintas");
    await expect(service.switchSucursales("e1", { usuarioAId: "andrea", sucursalAId: "mec", usuarioBId: "andrea", sucursalBId: "bj" })).rejects.toThrow("distintas");
    await expect(service.switchSucursales("e1", { usuarioAId: "andrea", sucursalAId: "bj", sucursalBId: "mec" })).rejects.toThrow("no está activa");
    await expect(service.switchSucursales("otra", { usuarioAId: "andrea", sucursalAId: "mec", sucursalBId: "bj" })).rejects.toThrow();
  });
});
