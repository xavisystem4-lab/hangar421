import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { EstadoMesa, RolUsuario } from "@hangar421/shared";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { Audit } from "../common/interceptors/audit.interceptor";
import { MesasService } from "./mesas.service";

@ApiTags("mesas")
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("mesas")
export class MesasController {
  constructor(private mesas: MesasService) {}

  @Get()
  listar(@Query("sucursalId") sucursalId: string) {
    return this.mesas.listar(sucursalId);
  }

  @Post()
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL)
  @Audit("MESA", "CREAR")
  crear(@Body() body: any) {
    return this.mesas.crear(body);
  }

  @Patch(":id/estado")
  cambiarEstado(@Param("id") id: string, @Body("estado") estado: EstadoMesa) {
    return this.mesas.cambiarEstado(id, estado);
  }

  @Patch(":id")
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL)
  @Audit("MESA", "ACTUALIZAR")
  actualizar(@Param("id") id: string, @Body() body: any) {
    return this.mesas.actualizar(id, body);
  }
}
