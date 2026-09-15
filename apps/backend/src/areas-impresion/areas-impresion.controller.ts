import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { RolUsuario } from "@hangar421/shared";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { Audit } from "../common/interceptors/audit.interceptor";
import { AreasImpresionService } from "./areas-impresion.service";

@ApiTags("areas-impresion")
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("areas-impresion")
export class AreasImpresionController {
  constructor(private areas: AreasImpresionService) {}

  @Get()
  listar(@Query("empresaId") empresaId: string) {
    return this.areas.listar(empresaId);
  }

  @Post()
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL)
  @Audit("AREA_IMPRESION", "CREAR")
  crear(@Body() body: { empresaId: string; nombre: string }) {
    return this.areas.crear(body.empresaId, body.nombre);
  }

  // Borrado real (no baja lógica): son solo etiquetas para catalogar el menú, sin historial
  // que preservar — a diferencia de Usuario/Perfil, nada más las referencia todavía.
  @Delete(":id")
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL)
  @Audit("AREA_IMPRESION", "ELIMINAR")
  eliminar(@Param("id") id: string) {
    return this.areas.eliminar(id);
  }
}
