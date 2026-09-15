import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class AreasImpresionService {
  constructor(private prisma: PrismaService) {}

  listar(empresaId: string) {
    return this.prisma.areaImpresion.findMany({
      where: { empresaId, activo: true },
      orderBy: { nombre: "asc" },
    });
  }

  crear(empresaId: string, nombre: string) {
    return this.prisma.areaImpresion.create({ data: { empresaId, nombre } });
  }

  eliminar(id: string) {
    return this.prisma.areaImpresion.delete({ where: { id } });
  }
}
