import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { RolUsuario } from "@hangar421/shared";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { Audit } from "../common/interceptors/audit.interceptor";
import { CajaService } from "./caja.service";

@ApiTags("caja")
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("caja")
export class CajaController {
  constructor(private caja: CajaService) {}

  @Post("turnos/abrir")
  @Roles(RolUsuario.CAJERO, RolUsuario.ADMIN_SUCURSAL, RolUsuario.ADMIN_CORPORATIVO)
  @Audit("TURNO", "ABRIR")
  abrir(@Body() body: { sucursalId: string; cajaId: string; usuarioId: string; montoInicial: number }) {
    return this.caja.abrirTurno(body);
  }

  @Get("cajas/:cajaId/turno-activo")
  turnoActivo(@Param("cajaId") cajaId: string) {
    return this.caja.turnoActivo(cajaId);
  }

  @Post("turnos/:id/cerrar")
  @Roles(RolUsuario.CAJERO, RolUsuario.SUPERVISOR, RolUsuario.ADMIN_SUCURSAL, RolUsuario.ADMIN_CORPORATIVO)
  @Audit("TURNO", "CERRAR")
  cerrar(@Param("id") id: string, @Body("montoFinalDeclarado") monto: number) {
    return this.caja.cerrarTurno(id, monto);
  }

  @Get("turnos/:id/resumen")
  resumen(@Param("id") id: string) {
    return this.caja.resumenTurno(id);
  }
}
