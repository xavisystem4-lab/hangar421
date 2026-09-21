import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { EstadoTurno, RolUsuario, TipoMovimientoCaja } from "@hangar421/shared";
import { sucursalDeLaConsulta } from "../common/sucursal-consulta.util";
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

  /** Turnos y cortes del ERP, con los turnos abiertos desde un día anterior aparte (`pendientes`).
   *  Mismo acotamiento por sucursal que la consulta de ventas (ver sucursalDeLaConsulta). */
  @Get("turnos")
  @Roles(RolUsuario.SUPERVISOR, RolUsuario.ADMIN_SUCURSAL, RolUsuario.ADMIN_CORPORATIVO)
  listarTurnos(
    @Req() req: any,
    @Query("sucursalId") sucursalId?: string,
    @Query("desde") desde?: string,
    @Query("hasta") hasta?: string,
    @Query("estado") estado?: string,
    @Query("usuarioId") usuarioId?: string,
  ) {
    return this.caja.listarTurnos(req.user.empresaId, {
      sucursalId: sucursalDeLaConsulta(req.user, sucursalId),
      desde,
      hasta,
      estado: estado === EstadoTurno.ABIERTO || estado === EstadoTurno.CERRADO ? estado : undefined,
      usuarioId: usuarioId || undefined,
    });
  }

  @Get("cajas/:cajaId/turno-activo")
  turnoActivo(@Param("cajaId") cajaId: string) {
    return this.caja.turnoActivo(cajaId);
  }

  @Post("turnos/:id/cerrar")
  @Roles(RolUsuario.CAJERO, RolUsuario.SUPERVISOR, RolUsuario.ADMIN_SUCURSAL, RolUsuario.ADMIN_CORPORATIVO)
  @Audit("TURNO", "CERRAR")
  cerrar(@Param("id") id: string, @Body() body: { montoFinalDeclarado: number; desgloseEfectivo?: unknown }) {
    return this.caja.cerrarTurno(id, body.montoFinalDeclarado, body.desgloseEfectivo);
  }

  @Get("turnos/:id/resumen")
  resumen(@Param("id") id: string) {
    return this.caja.resumenTurno(id);
  }

  @Post("turnos/:id/movimientos")
  @Roles(RolUsuario.CAJERO, RolUsuario.SUPERVISOR, RolUsuario.ADMIN_SUCURSAL, RolUsuario.ADMIN_CORPORATIVO)
  @Audit("MOVIMIENTO_CAJA", "CREAR")
  registrarMovimiento(
    @Param("id") id: string,
    @Body() body: { tipo: TipoMovimientoCaja; monto: number; motivo: string; usuarioId: string },
  ) {
    return this.caja.registrarMovimiento({ turnoId: id, ...body });
  }

  @Get("turnos/:id/movimientos")
  listarMovimientos(@Param("id") id: string) {
    return this.caja.listarMovimientos(id);
  }
}
