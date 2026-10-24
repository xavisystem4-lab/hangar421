import { Body, Controller, Get, Put, Query, Req, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { RolUsuario } from "@hangar421/shared";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { sucursalDeLaConsulta } from "../common/sucursal-consulta.util";
import { ReportesService } from "./reportes.service";

@ApiTags("reportes")
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("reportes")
export class ReportesController {
  constructor(private reportes: ReportesService) {}

  @Get("dashboard")
  dashboard(@Query("empresaId") empresaId: string, @Query("sucursalId") sucursalId?: string) {
    return this.reportes.dashboard(empresaId, sucursalId);
  }

  @Get("ventas-por-hora")
  ventasPorHora(@Query("sucursalId") sucursalId: string, @Query("fecha") fecha?: string) {
    return this.reportes.ventasPorHora(sucursalId, fecha);
  }

  @Get("ventas-por-producto")
  ventasPorProducto(
    @Query("empresaId") empresaId: string,
    @Query("desde") desde: string,
    @Query("hasta") hasta: string,
    @Query("sucursalId") sucursalId?: string,
    @Query("turnoId") turnoId?: string,
  ) {
    return this.reportes.ventasPorProducto(empresaId, new Date(desde), new Date(hasta), sucursalId, turnoId || undefined);
  }

  @Get("ventas-por-metodo-pago")
  ventasPorMetodoPago(@Query("sucursalId") sucursalId: string, @Query("desde") desde: string, @Query("hasta") hasta: string) {
    return this.reportes.ventasPorMetodoPago(sucursalId, new Date(desde), new Date(hasta));
  }

  /** Ventas de DiDi y ganancia real después de la comisión. Fechas "AAAA-MM-DD" en la zona de la
   *  sucursal; sin sucursal, el consolidado (solo ADMIN_CORPORATIVO, ver sucursalDeLaConsulta). */
  @Get("didi")
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL, RolUsuario.SUPERVISOR)
  reporteDidi(@Req() req: any, @Query("sucursalId") sucursalId?: string, @Query("desde") desde?: string, @Query("hasta") hasta?: string) {
    return this.reportes.reporteDidi(req.user.empresaId, { sucursalId: sucursalDeLaConsulta(req.user, sucursalId), desde, hasta });
  }

  @Get("didi/config")
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL, RolUsuario.SUPERVISOR)
  configDidi(@Req() req: any) {
    return this.reportes.configDidi(req.user.empresaId);
  }

  /** La comisión pactada es de la empresa: solo un administrador corporativo la cambia. */
  @Put("didi/config")
  @Roles(RolUsuario.ADMIN_CORPORATIVO)
  guardarConfigDidi(@Req() req: any, @Body() body: any) {
    return this.reportes.guardarConfigDidi(req.user.empresaId, body ?? {});
  }
}
