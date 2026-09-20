import { Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { RolUsuario } from "@hangar421/shared";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { Audit } from "../common/interceptors/audit.interceptor";
import { SucursalesService } from "./sucursales.service";

@ApiTags("sucursales")
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("sucursales")
export class SucursalesController {
  constructor(private sucursales: SucursalesService) {}

  @Get()
  listar(@Query("empresaId") empresaId: string) {
    return this.sucursales.listar(empresaId);
  }

  @Get(":id")
  obtener(@Param("id") id: string) {
    return this.sucursales.obtener(id);
  }

  @Post()
  @Roles(RolUsuario.ADMIN_CORPORATIVO)
  @Audit("SUCURSAL", "CREAR")
  crear(@Body() body: any) {
    return this.sucursales.crear(body);
  }

  @Put(":id")
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL)
  @Audit("SUCURSAL", "ACTUALIZAR")
  actualizar(@Param("id") id: string, @Body() body: any) {
    return this.sucursales.actualizar(id, body);
  }

  @Put(":id/config-ticket")
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL)
  @Audit("SUCURSAL", "ACTUALIZAR_CONFIG_TICKET")
  actualizarConfigTicket(@Param("id") id: string, @Body() body: unknown) {
    return this.sucursales.actualizarConfigTicket(id, body);
  }

  /**
   * Renombrar desde una terminal. El parámetro se llama `sucursalId` a propósito: así
   * SucursalAccessGuard lo compara contra el token y una terminal solo puede renombrar LA SUYA.
   *
   * No lleva @Roles: la sesión de una terminal es un CAJERO. Lo que autoriza es la contraseña
   * de un administrador, validada dentro del servicio.
   */
  @Patch(":sucursalId/nombre")
  @Audit("SUCURSAL", "RENOMBRAR")
  renombrarDesdeTerminal(
    @Param("sucursalId") sucursalId: string,
    @Body() body: { nombre: string; autorizadoPorId: string; password: string },
  ) {
    return this.sucursales.renombrarDesdeTerminal(sucursalId, body);
  }

  @Get(":id/areas")
  listarAreas(@Param("id") id: string) {
    return this.sucursales.listarAreas(id);
  }

  @Post(":id/areas")
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL)
  crearArea(@Param("id") id: string, @Body() body: any) {
    return this.sucursales.crearArea(id, body);
  }

  @Get(":id/dispositivos")
  listarDispositivos(@Param("id") id: string) {
    return this.sucursales.listarDispositivos(id);
  }

  @Post(":id/dispositivos")
  registrarDispositivo(@Param("id") id: string, @Body() body: any) {
    return this.sucursales.registrarDispositivo({ ...body, sucursalId: id });
  }

  @Get(":id/cajas")
  listarCajas(@Param("id") id: string) {
    return this.sucursales.listarCajas(id);
  }

  @Post(":id/cajas")
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL)
  crearCaja(@Param("id") id: string, @Body("nombre") nombre: string) {
    return this.sucursales.crearCaja(id, nombre);
  }
}
