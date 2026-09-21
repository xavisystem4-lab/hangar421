import { Body, Controller, Get, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { SyncService } from "./sync.service";
import { SyncHeartbeatDto, SyncPushDto } from "./dto/sync.dto";

@ApiTags("sync")
@UseGuards(JwtAuthGuard)
@Controller("sync")
export class SyncController {
  constructor(private sync: SyncService) {}

  @Post("push")
  push(@Req() req: any, @Body() dto: SyncPushDto) {
    return this.sync.push(dto.items as any, req.user);
  }

  @Get("pull")
  pull(@Query("sucursalId") sucursalId: string, @Query("since") since?: string) {
    return this.sync.pull(sucursalId, since);
  }

  /**
   * Operaciones que el ERP rechazó y siguen sin aplicarse — el monitoreo de "ventas que no
   * lograron sincronizarse".
   *
   * Los errores ya se guardaban en `sync_queue_items` con su motivo, pero no había forma de
   * verlos salvo entrando a los logs del servidor. Desde el ERP eran invisibles: una venta
   * rechazada por el backend (producto inexistente, usuario que no existe, importe inválido)
   * simplemente no aparecía y nadie se enteraba.
   *
   * Solo lectura y acotado a la empresa del token; `sucursalId` lo valida SucursalAccessGuard.
   */
  @Get("problemas")
  problemas(@Req() req: any, @Query("sucursalId") sucursalId?: string) {
    return this.sync.listarProblemas(req.user.empresaId, sucursalId);
  }

  /**
   * Latido de la terminal. Existe porque `push` solo se llama cuando hay algo en la cola: una
   * terminal encendida y al día no mandaba nada, así que el ERP la veía desconectada aunque
   * estuviera funcionando perfectamente. Con esto, "conectado" significa lo que la gente
   * entiende: la terminal está encendida y alcanza al ERP.
   */
  @Post("heartbeat")
  async heartbeat(@Body() dto: SyncHeartbeatDto) {
    await this.sync.marcarVisto(dto.dispositivoId, dto.sucursalId);
    return { serverTime: new Date().toISOString() };
  }
}
