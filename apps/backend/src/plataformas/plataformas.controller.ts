import { Body, Controller, Get, Headers, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Request } from "express";
import { EstadoSincronizacionOrdenPlataforma, RolUsuario } from "@hangar421/shared";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { Public } from "../common/decorators/public.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Audit } from "../common/interceptors/audit.interceptor";
import { PlataformasService } from "./plataformas.service";
import { AceptarPedidoEntranteDto, GuardarConfigPlataformaDto, RechazarPedidoEntranteDto } from "./dto/plataformas.dto";

const ROLES_ADMIN_PLATAFORMAS = [RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL];

@ApiTags("plataformas")
@Controller("plataformas")
export class PlataformasController {
  constructor(private plataformas: PlataformasService) {}

  // --- Administración > Plataformas ----------------------------------------------------------

  @Get("configuraciones")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES_ADMIN_PLATAFORMAS)
  listar(@Query("empresaId") empresaId: string) {
    return this.plataformas.listar(empresaId);
  }

  @Get("configuraciones/:plataforma")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES_ADMIN_PLATAFORMAS)
  obtenerUno(@Param("plataforma") plataforma: string, @Query("empresaId") empresaId: string) {
    return this.plataformas.obtenerUno(plataforma, empresaId);
  }

  // Sin @Audit: el body trae credenciales en claro (el backend las cifra antes de guardar) — la
  // auditoría de este endpoint se hace a mano dentro de PlataformasService.guardarConfig() para
  // no filtrar secretos en AuditLog.datosNuevos (ver comentario ahí).
  @Post("configuraciones/:plataforma")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES_ADMIN_PLATAFORMAS)
  guardarConfig(@Param("plataforma") plataforma: string, @Body() dto: GuardarConfigPlataformaDto, @CurrentUser() user: any) {
    return this.plataformas.guardarConfig(plataforma, dto, user);
  }

  @Post("configuraciones/:configId/probar-conexion")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES_ADMIN_PLATAFORMAS)
  @Audit("PLATAFORMA_CONFIG", "PROBAR_CONEXION")
  probarConexion(@Param("configId") configId: string) {
    return this.plataformas.probarConexion(configId);
  }

  @Post("configuraciones/:configId/reconectar")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES_ADMIN_PLATAFORMAS)
  @Audit("PLATAFORMA_CONFIG", "RECONECTAR")
  reconectar(@Param("configId") configId: string) {
    return this.plataformas.reconectar(configId);
  }

  @Post("configuraciones/:configId/desconectar")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES_ADMIN_PLATAFORMAS)
  @Audit("PLATAFORMA_CONFIG", "DESCONECTAR")
  desconectar(@Param("configId") configId: string) {
    return this.plataformas.desconectar(configId);
  }

  @Post("configuraciones/:configId/regenerar-webhook")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES_ADMIN_PLATAFORMAS)
  @Audit("PLATAFORMA_CONFIG", "REGENERAR_WEBHOOK")
  regenerarWebhook(@Param("configId") configId: string) {
    return this.plataformas.regenerarWebhook(configId);
  }

  // --- Pedidos entrantes (bandeja de aceptación manual) --------------------------------------

  @Get("pedidos")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES_ADMIN_PLATAFORMAS)
  listarPedidosEntrantes(@Query("empresaId") empresaId: string, @Query("estado") estado?: EstadoSincronizacionOrdenPlataforma) {
    return this.plataformas.listarPedidosEntrantes(empresaId, estado);
  }

  @Get("pedidos/:id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES_ADMIN_PLATAFORMAS)
  obtenerPedidoEntrante(@Param("id") id: string) {
    return this.plataformas.obtenerPedidoEntrante(id);
  }

  @Post("pedidos/:id/aceptar")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES_ADMIN_PLATAFORMAS)
  @Audit("PLATAFORMA_PEDIDO", "ACEPTAR")
  aceptarPedido(@Param("id") id: string, @Body() dto: AceptarPedidoEntranteDto) {
    return this.plataformas.aceptarPedido(id, dto);
  }

  @Post("pedidos/:id/rechazar")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES_ADMIN_PLATAFORMAS)
  @Audit("PLATAFORMA_PEDIDO", "RECHAZAR")
  rechazarPedido(@Param("id") id: string, @Body() dto: RechazarPedidoEntranteDto) {
    return this.plataformas.rechazarPedido(id, dto.motivo);
  }

  // --- Webhooks de las plataformas -------------------------------------------------------------
  // Sin JWT (ninguna plataforma de delivery manda uno) — la autenticidad se verifica dentro del
  // adaptador con la firma propia de cada plataforma. La URL incluye el `webhookSlug` rotable de
  // PlataformaConfig para resolver, sin adivinar, con qué cuenta/credenciales verificar esa firma
  // (mismo patrón que pagos.controller.ts -> webhooks/:configId).

  @Public()
  @Post("webhooks/:plataforma/:webhookSlug")
  async webhook(
    @Param("plataforma") plataforma: string,
    @Param("webhookSlug") webhookSlug: string,
    @Req() req: Request,
    @Headers() headers: Record<string, string>,
  ) {
    return this.plataformas.manejarWebhook(plataforma, webhookSlug, {
      headers,
      query: req.query as Record<string, string>,
      body: req.body,
    });
  }
}
