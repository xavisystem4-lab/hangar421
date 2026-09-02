import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class ClientesService {
  constructor(private prisma: PrismaService) {}

  listar(empresaId: string, busqueda?: string) {
    return this.prisma.cliente.findMany({
      where: {
        empresaId,
        ...(busqueda
          ? { OR: [{ nombre: { contains: busqueda, mode: "insensitive" } }, { telefono: { contains: busqueda } }] }
          : {}),
      },
      orderBy: { nombre: "asc" },
      take: 100,
    });
  }

  crear(data: { empresaId: string; nombre: string; telefono?: string; email?: string }) {
    return this.prisma.cliente.create({ data });
  }

  async historialCompras(clienteId: string) {
    return this.prisma.pedido.findMany({
      where: { clienteId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { items: true },
    });
  }
}
