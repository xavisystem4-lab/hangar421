import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { SyncService } from "./sync.service";
import { SyncPushDto } from "./dto/sync.dto";

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
}
