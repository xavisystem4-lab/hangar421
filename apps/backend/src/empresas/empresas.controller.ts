import { Body, Controller, Get, Param, Put, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { RolUsuario } from "@hangar421/shared";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { Audit } from "../common/interceptors/audit.interceptor";
import { EmpresasService } from "./empresas.service";

@ApiTags("empresas")
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("empresas")
export class EmpresasController {
  constructor(private empresas: EmpresasService) {}

  // El parámetro se llama `empresaId` (no `id`) a propósito: así EmpresaScopeGuard lo reconoce
  // y estas dos rutas quedan cubiertas sin lógica extra. La URL es la misma — el nombre del
  // parámetro es interno y no cambia el patrón de ruta.
  @Get(":empresaId")
  obtener(@Param("empresaId") id: string) {
    return this.empresas.obtener(id);
  }

  @Put(":empresaId")
  @Roles(RolUsuario.ADMIN_CORPORATIVO)
  @Audit("EMPRESA", "ACTUALIZAR")
  actualizar(@Param("empresaId") id: string, @Body() body: any) {
    return this.empresas.actualizar(id, body);
  }
}
