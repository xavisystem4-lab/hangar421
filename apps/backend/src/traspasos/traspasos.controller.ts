import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { RolUsuario } from "@hangar421/shared";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { Audit } from "../common/interceptors/audit.interceptor";
import { TraspasosService } from "./traspasos.service";

@ApiTags("traspasos")
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("traspasos")
export class TraspasosController {
  constructor(private traspasos: TraspasosService) {}

  @Get()
  listar(@Query("sucursalId") sucursalId: string) {
    return this.traspasos.listar(sucursalId);
  }

  @Post()
  @Audit("TRASPASO", "SOLICITAR")
  solicitar(@Body() body: any) {
    return this.traspasos.solicitar(body);
  }

  @Post(":id/autorizar")
  @Roles(RolUsuario.SUPERVISOR, RolUsuario.ADMIN_SUCURSAL, RolUsuario.ADMIN_CORPORATIVO)
  @Audit("TRASPASO", "AUTORIZAR")
  autorizar(@Param("id") id: string, @Body("usuarioAutorizaId") usuarioAutorizaId: string) {
    return this.traspasos.autorizar(id, usuarioAutorizaId);
  }

  @Post(":id/enviar")
  @Audit("TRASPASO", "ENVIAR")
  enviar(@Param("id") id: string, @Body() body: { usuarioEnviaId: string; items: { itemId: string; cantidad: number }[] }) {
    return this.traspasos.enviar(id, body.usuarioEnviaId, body.items);
  }

  @Post(":id/recibir")
  @Audit("TRASPASO", "RECIBIR")
  recibir(@Param("id") id: string, @Body() body: { usuarioRecibeId: string; items: { itemId: string; cantidad: number }[] }) {
    return this.traspasos.recibir(id, body.usuarioRecibeId, body.items);
  }

  @Post(":id/validar")
  @Roles(RolUsuario.SUPERVISOR, RolUsuario.ADMIN_SUCURSAL, RolUsuario.ADMIN_CORPORATIVO)
  @Audit("TRASPASO", "VALIDAR")
  validar(@Param("id") id: string) {
    return this.traspasos.validar(id);
  }

  @Post(":id/cancelar")
  @Audit("TRASPASO", "CANCELAR")
  cancelar(@Param("id") id: string) {
    return this.traspasos.cancelar(id);
  }
}
