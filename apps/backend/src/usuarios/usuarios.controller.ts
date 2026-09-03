import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
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

  @Patch(":id/activar")
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL)
  @Audit("USUARIO", "ACTIVAR")
  activar(@Param("id") id: string) {
    return this.usuarios.activar(id);
  }

  // --- Horarios ---

  @Get(":id/horarios")
  listarHorarios(@Param("id") id: string) {
    return this.usuarios.listarHorarios(id);
  }

  @Post(":id/horarios")
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL)
  @Audit("HORARIO", "CREAR")
  crearHorario(@Param("id") id: string, @Body() body: { sucursalId: string; diaSemana: number; horaInicio: string; horaFin: string; notas?: string }) {
    return this.usuarios.crearHorario(id, body);
  }

  @Patch("horarios/:horarioId")
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL)
  @Audit("HORARIO", "ACTUALIZAR")
  actualizarHorario(@Param("horarioId") horarioId: string, @Body() body: any) {
    return this.usuarios.actualizarHorario(horarioId, body);
  }

  @Delete("horarios/:horarioId")
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL)
  @Audit("HORARIO", "ELIMINAR")
  eliminarHorario(@Param("horarioId") horarioId: string) {
    return this.usuarios.eliminarHorario(horarioId);
  }
}
