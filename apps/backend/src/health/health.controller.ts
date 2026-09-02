import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Public } from "../common/decorators/public.decorator";

/** Usado por el POS Windows (modo standalone) para saber cuándo el backend embebido
 *  ya está listo para recibir tráfico, y por monitoreo externo en despliegues cloud. */
@ApiTags("health")
@Controller("health")
export class HealthController {
  @Public()
  @Get()
  estado() {
    return { status: "ok", timestamp: new Date().toISOString() };
  }
}
