import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class PerfilesService {
  constructor(private prisma: PrismaService) {}

  listar(empresaId: string) {
    return this.prisma.perfil.findMany({
      where: { empresaId },
      orderBy: { nombre: "asc" },
    });
  }

  crear(data: { empresaId: string; nombre: string; descripcion?: string; permisos: string[] }) {
    return this.prisma.perfil.create({ data });
  }

  actualizar(id: string, data: Partial<{ nombre: string; descripcion: string; permisos: string[]; activo: boolean }>) {
    return this.prisma.perfil.update({ where: { id }, data });
  }
}
