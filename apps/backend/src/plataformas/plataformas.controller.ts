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
import { AceptarPedidoEntranteDto, GuardarConfigPlataformaDto, RechazarPedidoEntranteDto, SimularPedidoDto } from "./dto/plataformas.dto";

const ROLES_ADMIN_PLATAFORMAS = [RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL];
/** Revisar, aceptar y rechazar pedidos es trabajo de caja; configurar credenciales, de admin. */
const ROLES_PEDIDOS_PLATAFORMAS = [...ROLES_ADMIN_PLATAFORMAS, RolUsuario.SUPERVISOR, RolUsuario.CAJERO];

// El `empresaId` SIEMPRE sale del token (user.empresaId). El query `empresaId` que mandan los
// clientes viejos se ignora: aceptarlo permitía leer o tocar datos de otra empresa.

@ApiTags("plataformas")
@Controller("plataformas")
export class PlataformasController {
  constructor(private plataformas: PlataformasService) {}

  // --- Administración > Plataformas ----------------------------------------------------------

  @Get("configuraciones")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES_ADMIN_PLATAFORMAS)
  listar(@CurrentUser() user: any, @Query("sucursalId") sucursalId?: string) {
    return this.plataformas.listar(user.empresaId, sucursalId || null);
  }

  @Get("configuraciones/:plataforma")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES_ADMIN_PLATAFORMAS)
  obtenerUno(@Param("plataforma") plataforma: string, @CurrentUser() user: any, @Query("sucursalId") sucursalId?: string) {
    return this.plataformas.obtenerUno(plataforma, user.empresaId, sucursalId || null);
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
  probarConexion(@Param("configId") configId: string, @CurrentUser() user: any) {
    return this.plataformas.probarConexion(configId, user.empresaId);
  }

  @Post("configuraciones/:configId/reconectar")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES_ADMIN_PLATAFORMAS)
  @Audit("PLATAFORMA_CONFIG", "RECONECTAR")
  reconectar(@Param("configId") configId: string, @CurrentUser() user: any) {
    return this.plataformas.reconectar(configId, user.empresaId);
  }

  @Post("configuraciones/:configId/desconectar")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES_ADMIN_PLATAFORMAS)
  @Audit("PLATAFORMA_CONFIG", "DESCONECTAR")
  desconectar(@Param("configId") configId: string, @CurrentUser() user: any) {
    return this.plataformas.desconectar(configId, user.empresaId);
  }

  @Post("configuraciones/:configId/regenerar-webhook")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES_ADMIN_PLATAFORMAS)
  @Audit("PLATAFORMA_CONFIG", "REGENERAR_WEBHOOK")
  regenerarWebhook(@Param("configId") configId: string, @CurrentUser() user: any) {
    return this.plataformas.regenerarWebhook(configId, user.empresaId);
  }

  // --- Pedidos entrantes (bandeja de aceptación manual) --------------------------------------

  @Get("pedidos")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES_PEDIDOS_PLATAFORMAS)
  listarPedidosEntrantes(
    @CurrentUser() user: any,
    @Query("estado") estado?: string,
    @Query("plataforma") plataforma?: string,
    @Query("sucursalId") sucursalId?: string,
    @Query("desde") desde?: string,
    @Query("limite") limite?: string,
  ) {
    const fecha = desde ? new Date(desde) : undefined;
    return this.plataformas.listarPedidosEntrantes(user.empresaId, {
      estado: estado || EstadoSincronizacionOrdenPlataforma.RECIBIDA,
      plataforma: plataforma || undefined,
      sucursalId: sucursalId || undefined,
      desde: fecha && !isNaN(fecha.getTime()) ? fecha : undefined,
      limite: limite ? Number(limite) || undefined : undefined,
    });
  }

  @Get("eventos/errores")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES_PEDIDOS_PLATAFORMAS)
  listarEventosConError(@CurrentUser() user: any, @Query("limite") limite?: string) {
    return this.plataformas.listarEventosConError(user.empresaId, limite ? Number(limite) || undefined : undefined);
  }

  @Get("pedidos/:id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES_PEDIDOS_PLATAFORMAS)
  obtenerPedidoEntrante(@Param("id") id: string, @CurrentUser() user: any) {
    return this.plataformas.obtenerPedidoEntrante(id, user.empresaId);
  }

  @Post("pedidos/simular")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES_ADMIN_PLATAFORMAS)
  @Audit("PLATAFORMA_PEDIDO", "SIMULAR")
  simularPedido(@Body() dto: SimularPedidoDto, @CurrentUser() user: any) {
    return this.plataformas.simularPedido(user.empresaId, dto.plataforma, dto.sucursalId ?? null);
  }

  @Post("pedidos/:id/aceptar")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES_PEDIDOS_PLATAFORMAS)
  @Audit("PLATAFORMA_PEDIDO", "ACEPTAR")
  aceptarPedido(@Param("id") id: string, @Body() dto: AceptarPedidoEntranteDto, @CurrentUser() user: any) {
    return this.plataformas.aceptarPedido(id, dto, user.empresaId);
  }

  @Post("pedidos/:id/rechazar")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES_PEDIDOS_PLATAFORMAS)
  @Audit("PLATAFORMA_PEDIDO", "RECHAZAR")
  rechazarPedido(@Param("id") id: string, @Body() dto: RechazarPedidoEntranteDto, @CurrentUser() user: any) {
    return this.plataformas.rechazarPedido(id, dto.motivo, user.empresaId, dto.confirmarManual === true);
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
    @Req() req: Request & { rawBody?: Buffer },
    @Headers() headers: Record<string, string>,
  ) {
    return this.plataformas.manejarWebhook(plataforma, webhookSlug, {
      headers,
      query: req.query as Record<string, string>,
      body: req.body,
      // Capturado en main.ts (json({ verify })) — las firmas se calculan sobre estos bytes.
      rawBody: req.rawBody ? req.rawBody.toString("utf8") : undefined,
    });
  }
}
