import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
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
  push(@Body() dto: SyncPushDto) {
    return this.sync.push(dto.items as any);
  }

  @Get("pull")
  pull(@Query("sucursalId") sucursalId: string, @Query("since") since?: string) {
    return this.sync.pull(sucursalId, since);
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
