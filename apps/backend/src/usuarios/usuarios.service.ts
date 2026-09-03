import { Injectable } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { RolUsuario } from "@hangar421/shared";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class UsuariosService {
  constructor(private prisma: PrismaService) {}

  listarPorSucursal(sucursalId: string) {
    return this.prisma.usuarioSucursal.findMany({
      where: { sucursalId, activo: true },
      include: { usuario: { select: { id: true, nombre: true, email: true, activo: true } } },
    });
  }

  async crear(data: {
    empresaId: string;
    nombre: string;
    email?: string;
    password?: string;
    pin?: string;
    sucursales: { sucursalId: string; rol: RolUsuario }[];
  }) {
    const passwordHash = data.password ? await bcrypt.hash(data.password, 12) : undefined;
    const pinHash = data.pin ? await bcrypt.hash(data.pin, 12) : undefined;

    return this.prisma.usuario.create({
      data: {
        empresaId: data.empresaId,
        nombre: data.nombre,
        email: data.email,
        passwordHash,
        pinHash,
        sucursales: {
          create: data.sucursales.map((s) => ({ sucursalId: s.sucursalId, rol: s.rol })),
        },
      },
      include: { sucursales: true },
    });
  }

  async actualizarPin(usuarioId: string, pin: string) {
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
