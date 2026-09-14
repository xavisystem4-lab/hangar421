import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class ProveedoresService {
  constructor(private prisma: PrismaService) {}

  listar(empresaId: string) {
    return this.prisma.proveedor.findMany({ where: { empresaId, activo: true }, orderBy: { nombre: "asc" } });
  }

  crear(data: { empresaId: string; nombre: string; telefono?: string; email?: string; notas?: string }) {
    return this.prisma.proveedor.create({ data });
  }

  actualizar(
    id: string,
    data: Partial<{ nombre: string; telefono: string | null; email: string | null; notas: string | null; activo: boolean }>,
  ) {
    return this.prisma.proveedor.update({ where: { id }, data });
  }
}
