import { BadRequestException, Injectable } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { RolUsuario, TurnoTrabajo } from "@hangar421/shared";
import { PrismaService } from "../prisma/prisma.service";

/** Primer nombre sin acentos ni mayúsculas: la misma persona tiene un usuario por sucursal. */
function mismaPersona(a: string, b: string): boolean {
  const clave = (n: string) => ((n ?? "").trim().split(/\s+/)[0] ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return clave(a) !== "" && clave(a) === clave(b);
}

@Injectable()
export class UsuariosService {
  constructor(private prisma: PrismaService) {}

  /** `usuario.tienePassword` / `tienePin` dicen si puede entrar al ERP (contraseña) o a la
   *  terminal (PIN); los hashes nunca salen. */
  async listarPorSucursal(sucursalId: string) {
    const filas = await this.prisma.usuarioSucursal.findMany({
      where: { sucursalId, activo: true, usuario: { eliminado: false } },
      include: {
        usuario: { select: { id: true, nombre: true, email: true, username: true, activo: true, passwordHash: true, pinHash: true } },
        perfil: { select: { id: true, nombre: true } },
      },
    });
    return filas.map((f) => {
      const { passwordHash, pinHash, ...usuario } = f.usuario;
      return { ...f, usuario: { ...usuario, tienePassword: !!passwordHash, tienePin: !!pinHash } };
    });
  }

  /**
   * El PIN es PERSONAL: dos personas con el mismo PIN pueden entrar una con el usuario de la otra
   * (pasó: Dalia abrió caja con el usuario de Diana). Se rechaza un PIN que ya use otra persona en
   * las mismas sucursales. Los usuarios de la misma persona (mismo primer nombre, uno por sucursal)
   * sí pueden compartirlo. Como el PIN se guarda con bcrypt, se compara contra cada hash.
   */
  async validarPinUnico(empresaId: string, pin: string, persona: { nombre: string; sucursalIds: string[]; excluirUsuarioId?: string }) {
    if (!pin) return;
    const otros = await this.prisma.usuario.findMany({
      where: {
        empresaId,
        eliminado: false,
        activo: true,
        pinHash: { not: null },
        ...(persona.excluirUsuarioId ? { id: { not: persona.excluirUsuarioId } } : {}),
        ...(persona.sucursalIds.length > 0 ? { sucursales: { some: { sucursalId: { in: persona.sucursalIds }, activo: true } } } : {}),
      },
      select: { nombre: true, pinHash: true },
    });
    for (const o of otros) {
      if (mismaPersona(o.nombre, persona.nombre)) continue;
      if (o.pinHash && (await bcrypt.compare(pin, o.pinHash))) {
        throw new BadRequestException(`Ese PIN ya lo usa otra persona (${o.nombre}). El PIN es personal: elige otro.`);
      }
    }
  }

  async crear(data: {
    empresaId: string;
    nombre: string;
    email?: string;
    username?: string;
    password?: string;
    pin?: string;
    sucursales: { sucursalId: string; rol: RolUsuario; turno?: TurnoTrabajo; perfilId?: string }[];
  }) {
    if (!data.email && !data.username) {
      throw new BadRequestException("Se requiere correo o nombre de usuario");
    }
    if (data.pin) {
      await this.validarPinUnico(data.empresaId, data.pin, { nombre: data.nombre, sucursalIds: data.sucursales.map((s) => s.sucursalId) });
    }
    const passwordHash = data.password ? await bcrypt.hash(data.password, 12) : undefined;
    const pinHash = data.pin ? await bcrypt.hash(data.pin, 12) : undefined;

    return this.prisma.usuario.create({
      data: {
        empresaId: data.empresaId,
        nombre: data.nombre,
        email: data.email || undefined,
        username: data.username || undefined,
        passwordHash,
        pinHash,
        sucursales: {
          create: data.sucursales.map((s) => ({
            sucursalId: s.sucursalId,
            rol: s.rol,
            turno: s.turno,
            perfilId: s.perfilId,
          })),
        },
      },
      include: { sucursales: true },
    });
  }

  async actualizarPin(usuarioId: string, pin: string) {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { empresaId: true, nombre: true, sucursales: { where: { activo: true }, select: { sucursalId: true } } },
    });
    if (usuario) {
      await this.validarPinUnico(usuario.empresaId, pin, {
        nombre: usuario.nombre,
        sucursalIds: usuario.sucursales.map((s) => s.sucursalId),
        excluirUsuarioId: usuarioId,
      });
    }
    const pinHash = await bcrypt.hash(pin, 12);
    return this.prisma.usuario.update({ where: { id: usuarioId }, data: { pinHash } });
  }

  async actualizarPassword(usuarioId: string, password: string) {
    const passwordHash = await bcrypt.hash(password, 12);
    return this.prisma.usuario.update({ where: { id: usuarioId }, data: { passwordHash } });
  }

  desactivar(usuarioId: string) {
    return this.prisma.usuario.update({ where: { id: usuarioId }, data: { activo: false } });
  }

  activar(usuarioId: string) {
    return this.prisma.usuario.update({ where: { id: usuarioId }, data: { activo: true } });
  }

  // Baja lógica permanente: nunca se borra el registro (conserva pedidos/turnos/auditoría ya
  // asociados), pero desaparece de los listados y ya no puede iniciar sesión.
  eliminar(usuarioId: string) {
    return this.prisma.usuario.update({
      where: { id: usuarioId },
      data: { eliminado: true, activo: false, eliminadoAt: new Date() },
    });
  }

  actualizarAsignacion(
    usuarioId: string,
    sucursalId: string,
    data: Partial<{ rol: RolUsuario; turno: TurnoTrabajo | null; perfilId: string | null }>,
  ) {
    return this.prisma.usuarioSucursal.update({
      where: { usuarioId_sucursalId: { usuarioId, sucursalId } },
      data,
    });
  }

  // --- Horarios (turno semanal recurrente, no confundir con Turno de caja) ---

  listarHorarios(usuarioId: string) {
    return this.prisma.horarioUsuario.findMany({
      where: { usuarioId },
      include: { sucursal: { select: { id: true, nombre: true } } },
      orderBy: [{ diaSemana: "asc" }, { horaInicio: "asc" }],
    });
  }

  crearHorario(usuarioId: string, data: { sucursalId: string; diaSemana: number; horaInicio: string; horaFin: string; notas?: string }) {
    return this.prisma.horarioUsuario.create({ data: { usuarioId, ...data } });
  }

  actualizarHorario(horarioId: string, data: Partial<{ diaSemana: number; horaInicio: string; horaFin: string; notas: string }>) {
    return this.prisma.horarioUsuario.update({ where: { id: horarioId }, data });
  }

  eliminarHorario(horarioId: string) {
    return this.prisma.horarioUsuario.delete({ where: { id: horarioId } });
  }
}
