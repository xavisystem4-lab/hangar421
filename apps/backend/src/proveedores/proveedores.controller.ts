import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { RolUsuario } from "@hangar421/shared";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { Audit } from "../common/interceptors/audit.interceptor";
import { ProveedoresService } from "./proveedores.service";

@ApiTags("proveedores")
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("proveedores")
export class ProveedoresController {
  constructor(private proveedores: ProveedoresService) {}

  @Get()
  listar(@Query("empresaId") empresaId: string) {
    return this.proveedores.listar(empresaId);
  }

  @Post()
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL)
  @Audit("PROVEEDOR", "CREAR")
  crear(@Body() body: any) {
    return this.proveedores.crear(body);
  }

  // También usado para "eliminar" (baja lógica, { activo: false }) — mismo patrón que
  // CatalogoController.actualizarProducto: nunca se borra el registro, para no perder la
  // referencia de los insumos que ya lo tienen asignado.
  @Patch(":id")
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL)
  @Audit("PROVEEDOR", "ACTUALIZAR")
  actualizar(@Param("id") id: string, @Body() body: any) {
    return this.proveedores.actualizar(id, body);
  }
}
