import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { RolUsuario } from "@hangar421/shared";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { Audit } from "../common/interceptors/audit.interceptor";
import { PerfilesService } from "./perfiles.service";

@ApiTags("perfiles")
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("perfiles")
export class PerfilesController {
  constructor(private perfiles: PerfilesService) {}

  @Get()
  listar(@Query("empresaId") empresaId: string) {
    return this.perfiles.listar(empresaId);
  }

  @Post()
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL)
  @Audit("PERFIL", "CREAR")
  crear(@Body() body: any) {
    return this.perfiles.crear(body);
  }

  // Baja lógica vía { activo: false } — mismo patrón que ProveedoresController: un perfil
  // desactivado deja de poder asignarse a usuarios nuevos, pero no rompe a quienes ya lo tienen.
  @Patch(":id")
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL)
  @Audit("PERFIL", "ACTUALIZAR")
  actualizar(@Param("id") id: string, @Body() body: any) {
    return this.perfiles.actualizar(id, body);
  }
}
