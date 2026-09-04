import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Public } from "../common/decorators/public.decorator";
import { PrismaService } from "../prisma/prisma.service";

/** Usado por el POS Windows (modo standalone) para saber cuándo el backend embebido
 *  ya está listo para recibir tráfico, por monitoreo externo en despliegues cloud, y por la
 *  app de Meseros (ConexionScreen) para "reconocer" la Estación antes de guardarla — muestra
 *  el nombre de la empresa en vez de solo IP:puerto, para que el mesero pueda confirmar que
 *  apuntó al negocio correcto. */
@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(private prisma: PrismaService) {}

  @Public()
  @Get()
  async estado() {
    const empresa = await this.prisma.empresa.findFirst({ orderBy: { createdAt: "asc" }, select: { nombre: true } });
    return { status: "ok", timestamp: new Date().toISOString(), empresa: empresa?.nombre ?? null };
  }
}
