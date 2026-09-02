import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { CocinaService } from "./cocina.service";

@ApiTags("cocina")
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("cocina")
export class CocinaController {
  constructor(private cocina: CocinaService) {}

  @Get("comandas")
  listar(@Query("sucursalId") sucursalId: string, @Query("estacionCocinaId") estacionCocinaId?: string) {
    return this.cocina.listarComandas(sucursalId, estacionCocinaId);
  }
}
