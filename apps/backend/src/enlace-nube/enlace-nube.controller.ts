import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { RolUsuario } from "@hangar421/shared";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { Audit } from "../common/interceptors/audit.interceptor";
import { EnlaceNubeService } from "./enlace-nube.service";

/** Enlace del POS de Windows con el ERP en la nube. Solo administradores del POS; en la nube
 *  todos responden 403 (ver EnlaceNubeService.exigirPosLocal). */
@ApiTags("enlace-nube")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL)
@Controller("enlace-nube")
export class EnlaceNubeController {
  constructor(private enlace: EnlaceNubeService) {}

  @Get()
  estado() {
    return this.enlace.estado();
  }

  @Post("vincular")
  @Audit("ENLACE_NUBE", "VINCULAR")
  vincular(@Req() req: any, @Body() body: { urlErp: string; codigo: string; sucursalIdLocal: string; sincronizarDesde?: string }) {
    return this.enlace.vincular(req.user.empresaId, body);
  }

  @Post("desvincular")
  @Audit("ENLACE_NUBE", "DESVINCULAR")
  desvincular() {
    return this.enlace.desvincular();
  }

  @Post("sincronizar")
  sincronizar() {
    return this.enlace.sincronizarAhora();
  }

  @Get("productos-por-relacionar")
  productosPorRelacionar() {
    return this.enlace.productosPorRelacionar();
  }

  @Post("relacionar")
  @Audit("ENLACE_NUBE", "RELACIONAR_PRODUCTO")
  relacionar(@Body() body: { idLocal: string; idNube: string }) {
    return this.enlace.relacionar(body.idLocal, body.idNube);
  }
}
