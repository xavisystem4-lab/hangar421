import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { RolUsuario } from "@hangar421/shared";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { SucursalLibre } from "../common/decorators/sucursal-libre.decorator";
import { Audit } from "../common/interceptors/audit.interceptor";
import { MonederoService, type ConfigurarMonederoDto } from "./monedero.service";
import { AvisaTerminales } from "../common/interceptors/cambios-erp.interceptor";

/**
 * Crédito de empleado. La empresa sale SIEMPRE de la sesión (nunca del query string). El monedero
 * es el mismo en todas las sucursales, por eso `@SucursalLibre`.
 */
@ApiTags("monedero")
@UseGuards(JwtAuthGuard, RolesGuard)
@SucursalLibre()
@AvisaTerminales("Crédito de empleados")
@Controller("monedero")
export class MonederoController {
  constructor(private monedero: MonederoService) {}

  /** Lo que baja la terminal: monederos activos + consumos recientes. */
  @Get("terminal")
  paraTerminal(@Req() req: any) {
    return this.monedero.paraTerminal(req.user.empresaId);
  }

  /** Reporte: consumo del crédito por empleada con el detalle de productos, fecha y hora. */
  @Get("consumos")
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL)
  consumos(@Req() req: any, @Query("desde") desde?: string, @Query("hasta") hasta?: string, @Query("sucursalId") sucursalId?: string) {
    return this.monedero.reporteConsumos(req.user.empresaId, { desde, hasta, sucursalId: sucursalId || undefined });
  }

  /** Manda el reporte de crédito por correo (PDF y Excel adjuntos). */
  @Post("consumos/enviar")
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL)
  @Audit("MONEDERO", "ENVIAR_REPORTE")
  enviarConsumos(@Req() req: any, @Body() body: any) {
    return this.monedero.enviarReporteConsumos(req.user.empresaId, body ?? {}, req.user?.nombre);
  }

  @Get()
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL)
  listar(@Req() req: any) {
    return this.monedero.listar(req.user.empresaId);
  }

  @Put(":usuarioId")
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL)
  @Audit("MONEDERO", "CONFIGURAR")
  configurar(@Req() req: any, @Param("usuarioId") usuarioId: string, @Body() body: ConfigurarMonederoDto) {
    return this.monedero.configurar(req.user.empresaId, usuarioId, body);
  }
}
