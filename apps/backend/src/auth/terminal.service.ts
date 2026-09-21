import { Injectable, UnauthorizedException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { JwtPayload, RolUsuario } from "@hangar421/shared";
import { PrismaService } from "../prisma/prisma.service";
import { PREFIJO_USUARIO_TERMINAL } from "../common/usuario-terminal.util";

/**
 * Lo que necesita una terminal (APK) que opera en varias sucursales: en cuáles puede operar,
 * quién tiene asignada cada una, validar el PIN de alguien que entra por primera vez en ese
 * equipo, y los precios de todas sus sucursales para poder cambiar de una a otra sin conexión.
 *
 * Todo se acota a las sucursales de la SESIÓN (los `UsuarioSucursal` del usuario-terminal, o
 * todas las de la empresa para un ADMIN_CORPORATIVO): la terminal nunca ve personas ni precios
 * de una sucursal que no le corresponde.
 */
@Injectable()
export class TerminalService {
  constructor(private prisma: PrismaService) {}

  /** Sucursales activas en las que puede operar la sesión. */
  async sucursalesDeLaSesion(sesion: JwtPayload): Promise<{ id: string; nombre: string }[]> {
    if (sesion.rol === RolUsuario.ADMIN_CORPORATIVO) {
      return this.prisma.sucursal.findMany({
        where: { empresaId: sesion.empresaId, activo: true },
        select: { id: true, nombre: true },
        orderBy: { nombre: "asc" },
      });
    }
    const accesos = await this.prisma.usuarioSucursal.findMany({
      where: { usuarioId: sesion.sub, activo: true, sucursal: { empresaId: sesion.empresaId, activo: true } },
      select: { sucursal: { select: { id: true, nombre: true } } },
    });
    return accesos.map((a) => a.sucursal).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  }

  /**
   * Sucursales de la terminal y las personas asignadas a cada una en el ERP. Es lo que usa la
   * tablet para ofrecer, al entrar con PIN, solo las sucursales que esa persona tiene asignadas.
   * Nunca incluye material de PIN: `tienePin` solo dice si puede hacer su primera entrada en
   * línea (sin PIN en el ERP no hay contra qué validarlo).
   */
  async contexto(sesion: JwtPayload) {
    const sucursales = await this.sucursalesDeLaSesion(sesion);
    const ids = sucursales.map((s) => s.id);
    const usuarios = await this.prisma.usuario.findMany({
      where: {
        empresaId: sesion.empresaId,
        activo: true,
        eliminado: false,
        // Fuera los usuarios-terminal. Explícito para `username` vacío: en SQL
        // `NOT (NULL LIKE 'terminal.%')` es NULL, no verdadero, y un NOT a secas descartaba a
        // toda persona sin nombre de usuario (las que entran con correo).
        OR: [{ username: null }, { NOT: { username: { startsWith: PREFIJO_USUARIO_TERMINAL } } }],
        sucursales: { some: { sucursalId: { in: ids }, activo: true } },
      },
      select: {
        id: true,
        nombre: true,
        pinHash: true,
        sucursales: { where: { sucursalId: { in: ids }, activo: true }, select: { sucursalId: true, rol: true } },
      },
      orderBy: { nombre: "asc" },
    });
    return {
      sucursales,
      usuarios: usuarios.map((u) => ({ id: u.id, nombre: u.nombre, tienePin: !!u.pinHash, sucursales: u.sucursales })),
    };
  }

  /**
   * Primera entrada de una persona en esta terminal: valida su PIN contra el ERP. NO emite una
   * sesión para esa persona (la terminal sigue con la suya): solo confirma quién es y en qué
   * sucursales de esta terminal puede operar, para que la tablet guarde su hash local y la
   * próxima vez entre sin conexión. Un solo mensaje para "no existe", "sin PIN" y "PIN
   * incorrecto", para no revelar cuáles existen.
   */
  async verificarPin(sesion: JwtPayload, usuarioId: string, pin: string) {
    const invalido = () => new UnauthorizedException("Usuario o PIN incorrecto");
    const ids = (await this.sucursalesDeLaSesion(sesion)).map((s) => s.id);
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: {
        id: true,
        nombre: true,
        empresaId: true,
        activo: true,
        eliminado: true,
        pinHash: true,
        sucursales: { where: { sucursalId: { in: ids }, activo: true }, select: { sucursalId: true, rol: true } },
      },
    });
    if (!usuario || usuario.empresaId !== sesion.empresaId || !usuario.activo || usuario.eliminado || !usuario.pinHash) throw invalido();
    if (usuario.sucursales.length === 0) throw invalido();
    if (!(await bcrypt.compare(pin, usuario.pinHash))) throw invalido();
    return { id: usuario.id, nombre: usuario.nombre, sucursales: usuario.sucursales };
  }

  /**
   * Precio y disponibilidad efectivos de cada producto activo en CADA sucursal de la terminal
   * (el precio de la sucursal si tiene uno, si no el base). Con esto la tablet puede cambiar de
   * sucursal sin conexión y cobrar con los precios correctos de la nueva.
   */
  async precios(sesion: JwtPayload) {
    const ids = (await this.sucursalesDeLaSesion(sesion)).map((s) => s.id);
    const productos = await this.prisma.producto.findMany({
      where: { empresaId: sesion.empresaId, activo: true },
      select: { id: true, precioBase: true, sucursales: { where: { sucursalId: { in: ids } }, select: { sucursalId: true, precio: true, disponible: true } } },
    });
    const filas: { sucursalId: string; productoId: string; precio: number; disponible: boolean }[] = [];
    for (const p of productos) {
      for (const sucursalId of ids) {
        const override = p.sucursales.find((s) => s.sucursalId === sucursalId);
        filas.push({
          sucursalId,
          productoId: p.id,
          precio: Number(override ? override.precio : p.precioBase),
          disponible: override ? override.disponible : true,
        });
      }
    }
    return filas;
  }
}
