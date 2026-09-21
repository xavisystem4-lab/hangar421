import { UnauthorizedException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { RolUsuario } from "@hangar421/shared";
import { TerminalService } from "./terminal.service";

const SESION: any = { sub: "terminal-1", empresaId: "emp-1", sucursalId: "suc-mec", rol: RolUsuario.CAJERO, type: "access" };

function crearServicio(usuario: any = null) {
  const prisma: any = {
    usuarioSucursal: {
      findMany: jest.fn(async () => [{ sucursal: { id: "suc-mec", nombre: "Mecánicos" } }, { sucursal: { id: "suc-bj", nombre: "Benito Juárez" } }]),
    },
    sucursal: { findMany: jest.fn(async () => []) },
    usuario: { findUnique: jest.fn(async () => usuario), findMany: jest.fn(async () => []) },
    producto: {
      findMany: jest.fn(async () => [
        { id: "p-latte", precioBase: 50, sucursales: [{ sucursalId: "suc-bj", precio: 55, disponible: true }] },
        { id: "p-pan", precioBase: 30, sucursales: [{ sucursalId: "suc-mec", precio: 30, disponible: false }] },
      ]),
    },
  };
  return { servicio: new TerminalService(prisma), prisma };
}

describe("TerminalService", () => {
  it("las sucursales de la sesión son las del usuario-terminal, ordenadas", async () => {
    const { servicio } = crearServicio();
    expect((await servicio.sucursalesDeLaSesion(SESION)).map((s) => s.nombre)).toEqual(["Benito Juárez", "Mecánicos"]);
  });

  it("precios: el de la sucursal si existe, si no el base; y la disponibilidad por sucursal", async () => {
    const { servicio } = crearServicio();
    const filas = await servicio.precios(SESION);
    const de = (p: string, s: string) => filas.find((f) => f.productoId === p && f.sucursalId === s);
    expect(de("p-latte", "suc-bj")).toMatchObject({ precio: 55, disponible: true });
    expect(de("p-latte", "suc-mec")).toMatchObject({ precio: 50, disponible: true });
    expect(de("p-pan", "suc-mec")).toMatchObject({ precio: 30, disponible: false });
  });

  // Regresión encontrada al probar contra PostgreSQL: un NOT a secas sobre `username` descartaba
  // a toda persona sin nombre de usuario (NOT de NULL es NULL en SQL), o sea a casi todas.
  it("excluye a los usuarios-terminal sin descartar a quien no tiene nombre de usuario", async () => {
    const { servicio, prisma } = crearServicio();
    await servicio.contexto(SESION);
    const where = prisma.usuario.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ username: null }, { NOT: { username: { startsWith: "terminal." } } }]);
  });

  it("el contexto nunca devuelve el hash del PIN", async () => {
    const { servicio, prisma } = crearServicio();
    prisma.usuario.findMany = jest.fn(async () => [{ id: "u-ana", nombre: "Ana", pinHash: "$2a$secreto", sucursales: [{ sucursalId: "suc-mec", rol: "CAJERO" }] }]);
    const ctx = await servicio.contexto(SESION);
    expect(ctx.usuarios[0]).toEqual({ id: "u-ana", nombre: "Ana", tienePin: true, sucursales: [{ sucursalId: "suc-mec", rol: "CAJERO" }] });
    expect(JSON.stringify(ctx)).not.toContain("secreto");
  });

  describe("verificarPin (primera entrada en la tablet)", () => {
    const conUsuario = async (extra: any = {}) => ({
      id: "u-ana", nombre: "Ana", empresaId: "emp-1", activo: true, eliminado: false,
      pinHash: await bcrypt.hash("2222", 4), sucursales: [{ sucursalId: "suc-mec", rol: "CAJERO" }], ...extra,
    });

    it("con el PIN correcto devuelve quién es y sus sucursales en esta terminal", async () => {
      const { servicio } = crearServicio(await conUsuario());
      await expect(servicio.verificarPin(SESION, "u-ana", "2222")).resolves.toEqual({ id: "u-ana", nombre: "Ana", sucursales: [{ sucursalId: "suc-mec", rol: "CAJERO" }] });
    });

    it("PIN incorrecto, sin PIN, otra empresa o sin sucursal en esta terminal: mismo rechazo", async () => {
      for (const [usuario, pin] of [
        [await conUsuario(), "9999"],
        [await conUsuario({ pinHash: null }), "2222"],
        [await conUsuario({ empresaId: "emp-2" }), "2222"],
        [await conUsuario({ sucursales: [] }), "2222"],
      ] as const) {
        const { servicio } = crearServicio(usuario);
        await expect(servicio.verificarPin(SESION, "u-ana", pin)).rejects.toThrow(new UnauthorizedException("Usuario o PIN incorrecto"));
      }
    });
  });
});
