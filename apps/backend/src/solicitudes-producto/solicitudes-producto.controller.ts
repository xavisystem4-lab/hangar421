import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { EstadoSolicitudProducto, RolUsuario } from "@hangar421/shared";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { Audit } from "../common/interceptors/audit.interceptor";
import { sucursalDeLaConsulta } from "../common/sucursal-consulta.util";
import { SolicitudesProductoService } from "./solicitudes-producto.service";

@ApiTags("solicitudes-producto")
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("solicitudes-producto")
export class SolicitudesProductoController {
  constructor(private solicitudes: SolicitudesProductoService) {}

  /** Alta desde un punto de venta en línea (el POS de Windows). Cualquier rol: quien está
   *  vendiendo es quien se topa con el producto que falta. Empresa y usuario salen del token; la
   *  sucursal la valida SucursalAccessGuard contra la sesión. El APK usa /sync/push. */
  @Post()
  crear(@Req() req: any, @Body() body: { id: string; sucursalId: string; texto: string; dispositivoId?: string; solicitadaEn?: string }) {
    return this.solicitudes.crear({
      id: body.id,
      empresaId: req.user.empresaId,
      sucursalId: body.sucursalId,
      usuarioId: req.user.sub,
      dispositivoHuella: body.dispositivoId,
      texto: body.texto,
      solicitadaEn: body.solicitadaEn ? new Date(body.solicitadaEn) : undefined,
    });
  }

  @Get()
  @Roles(RolUsuario.SUPERVISOR, RolUsuario.ADMIN_SUCURSAL, RolUsuario.ADMIN_CORPORATIVO)
  listar(@Req() req: any, @Query("sucursalId") sucursalId?: string, @Query("estado") estado?: string) {
    return this.solicitudes.listar(req.user.empresaId, {
      sucursalId: sucursalDeLaConsulta(req.user, sucursalId),
      estado: (Object.values(EstadoSolicitudProducto) as string[]).includes(estado ?? "") ? (estado as EstadoSolicitudProducto) : undefined,
    });
  }

  /** Va antes de `:id` por orden de declaración (aunque aquí `:id` solo existe en PATCH). */
  @Get("resumen")
  @Roles(RolUsuario.SUPERVISOR, RolUsuario.ADMIN_SUCURSAL, RolUsuario.ADMIN_CORPORATIVO)
  resumen(@Req() req: any, @Query("sucursalId") sucursalId?: string) {
    return this.solicitudes.contarPendientes(req.user.empresaId, sucursalDeLaConsulta(req.user, sucursalId));
  }

  @Patch(":id")
  @Roles(RolUsuario.ADMIN_SUCURSAL, RolUsuario.ADMIN_CORPORATIVO)
  @Audit("SOLICITUD_PRODUCTO", "RESOLVER")
  resolver(@Req() req: any, @Param("id") id: string, @Body() body: { estado: EstadoSolicitudProducto; productoId?: string; nota?: string }) {
    return this.solicitudes.resolver(id, req.user, body);
  }
}
