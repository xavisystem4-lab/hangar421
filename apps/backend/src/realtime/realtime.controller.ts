import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RealtimeGateway } from "./realtime.gateway";

@ApiTags("realtime")
@UseGuards(JwtAuthGuard)
@Controller("realtime")
export class RealtimeController {
  constructor(private gateway: RealtimeGateway) {}

  /** Tablets de meseros conectadas ahora mismo — lo consume Administración → "Conexión
   *  Meseros" en el POS para mostrar qué dispositivos están enlazados y con qué IP. */
  @Get("conectados")
  conectados(@Query("sucursalId") sucursalId: string) {
    return this.gateway.listarConectados(sucursalId);
  }
}
