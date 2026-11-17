import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { RolUsuario } from "@hangar421/shared";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { Audit } from "../common/interceptors/audit.interceptor";
import { AvisaTerminales } from "../common/interceptors/cambios-erp.interceptor";
import { sucursalDeLaConsulta } from "../common/sucursal-consulta.util";
import { ComprasService, type DatosCompra } from "./compras.service";

/**
 * ERP → 🛒 Compras y costos. Registrar y anular es solo de administradores (el dueño y la
 * encargada): el personal ya no mete mercancía ni corrige costos. Consultar lo pueden también
 * los supervisores. Cada alta y anulación queda en la bitácora (AuditLog) con quién la hizo.
 */
@ApiTags("inventario")
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("inventario/compras")
export class ComprasController {
  constructor(private compras: ComprasService) {}

  @Get()
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL, RolUsuario.SUPERVISOR)
  listar(
    @Req() req: any,
    @Query("sucursalId") sucursalId?: string,
    @Query("desde") desde?: string,
    @Query("hasta") hasta?: string,
    @Query("insumoId") insumoId?: string,
    @Query("proveedorId") proveedorId?: string,
    @Query("usuarioId") usuarioId?: string,
    @Query("categoria") categoria?: string,
    @Query("incluirAnuladas") incluirAnuladas?: string,
  ) {
    return this.compras.listar(req.user.empresaId, {
      sucursalId: sucursalDeLaConsulta(req.user, sucursalId || undefined),
      desde: desde || undefined,
      hasta: hasta || undefined,
      insumoId: insumoId || undefined,
      proveedorId: proveedorId || undefined,
      usuarioId: usuarioId || undefined,
      categoria: categoria || undefined,
      incluirAnuladas: incluirAnuladas === "1" || incluirAnuladas === "true",
    });
  }

  @Post()
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL)
  @Audit("COMPRA_INSUMO", "REGISTRAR")
  @AvisaTerminales("Inventario y recetas")
  registrar(@Req() req: any, @Body() body: DatosCompra) {
    return this.compras.registrar(req.user.empresaId, req.user.sub, body);
  }

  @Post(":id/anular")
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL)
  @Audit("COMPRA_INSUMO", "ANULAR")
  @AvisaTerminales("Inventario y recetas")
  anular(@Req() req: any, @Param("id") id: string, @Body("motivo") motivo: string) {
    return this.compras.anular(req.user.empresaId, req.user.sub, id, motivo);
  }
}
