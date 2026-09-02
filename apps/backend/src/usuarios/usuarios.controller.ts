import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { RolUsuario } from "@hangar421/shared";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { Audit } from "../common/interceptors/audit.interceptor";
import { UsuariosService } from "./usuarios.service";

@ApiTags("usuarios")
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("usuarios")
export class UsuariosController {
  constructor(private usuarios: UsuariosService) {}

  @Get()
  listar(@Query("sucursalId") sucursalId: string) {
    return this.usuarios.listarPorSucursal(sucursalId);
  }

  @Post()
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL)
  @Audit("USUARIO", "CREAR")
  crear(@Body() body: any) {
    return this.usuarios.crear(body);
  }

  @Patch(":id/pin")
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL)
  @Audit("USUARIO", "CAMBIAR_PIN")
  actualizarPin(@Param("id") id: string, @Body("pin") pin: string) {
    return this.usuarios.actualizarPin(id, pin);
  }

  @Patch(":id/password")
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL)
  @Audit("USUARIO", "CAMBIAR_PASSWORD")
  actualizarPassword(@Param("id") id: string, @Body("password") password: string) {
    return this.usuarios.actualizarPassword(id, password);
  }

  @Patch(":id/desactivar")
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL)
  @Audit("USUARIO", "DESACTIVAR")
  desactivar(@Param("id") id: string) {
    return this.usuarios.desactivar(id);
  }
}
