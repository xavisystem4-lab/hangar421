import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class EmpresasService {
  constructor(private prisma: PrismaService) {}

  obtener(id: string) {
    return this.prisma.empresa.findUniqueOrThrow({
      where: { id },
      include: { sucursales: { where: { activo: true } } },
    });
  }

  actualizar(id: string, data: { nombre?: string; rfc?: string; logoUrl?: string; configJson?: object }) {
    return this.prisma.empresa.update({ where: { id }, data });
  }
}
