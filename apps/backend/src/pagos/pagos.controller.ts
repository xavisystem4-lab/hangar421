import { Body, Controller, Get, Headers, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Request } from "express";
import { OrigenEventoPago, RolUsuario } from "@hangar421/shared";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { Public } from "../common/decorators/public.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Audit } from "../common/interceptors/audit.interceptor";
import { PagosService } from "./pagos.service";
import { PushService } from "./push.service";
import { ActualizarTerminalDto, CrearSolicitudPagoDto, CrearTerminalDto, GuardarConfigProveedorDto } from "./dto/pagos.dto";

const ROLES_ADMIN_TERMINALES = [RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL, RolUsuario.SUPERVISOR];

@ApiTags("pagos")
@Controller("pagos")
export class PagosController {
  constructor(private pagos: PagosService, private push: PushService) {}

  // --- Administración > Terminales de pago --------------------------------------------------

  @Get("proveedores")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES_ADMIN_TERMINALES)
  listarConfigProveedor(@Query("empresaId") empresaId: string) {
    return this.pagos.listarConfigProveedor(empresaId);
  }

  @Post("proveedores")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES_ADMIN_TERMINALES)
  @Audit("PAGO_PROVEEDOR_CONFIG", "GUARDAR")
  guardarConfigProveedor(@Body() dto: GuardarConfigProveedorDto) {
    return this.pagos.guardarConfigProveedor(dto);
  }

  @Post("proveedores/:configId/probar-conexion")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES_ADMIN_TERMINALES)
  probarConexionProveedor(@Param("configId") configId: string) {
    return this.pagos.probarConexionProveedor(configId);
  }

  @Get("proveedores/:configId/terminales-disponibles")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES_ADMIN_TERMINALES)
  terminalesDisponiblesProveedor(@Param("configId") configId: string) {
    return this.pagos.terminalesDisponiblesProveedor(configId);
  }

  @Get("terminales")
  @UseGuards(JwtAuthGuard)
  listarTerminales(@Query("sucursalId") sucursalId: string) {
    return this.pagos.listarTerminales(sucursalId);
  }

  @Post("terminales")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES_ADMIN_TERMINALES)
  @Audit("PAGO_TERMINAL", "CREAR")
  crearTerminal(@Body() dto: CrearTerminalDto) {
    return this.pagos.crearTerminal(dto);
  }

  @Patch("terminales/:id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES_ADMIN_TERMINALES)
  @Audit("PAGO_TERMINAL", "ACTUALIZAR")
  actualizarTerminal(@Param("id") id: string, @Body() dto: ActualizarTerminalDto) {
    return this.pagos.actualizarTerminal(id, dto);
  }

  @Post("terminales/:id/eliminar")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES_ADMIN_TERMINALES)
  @Audit("PAGO_TERMINAL", "ELIMINAR")
  eliminarTerminal(@Param("id") id: string) {
    return this.pagos.eliminarTerminal(id);
  }

  @Post("terminales/:id/probar-conexion")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES_ADMIN_TERMINALES)
  probarConexionTerminal(@Param("id") id: string) {
    return this.pagos.probarConexionTerminal(id);
  }

  @Get("terminales/:id/historial")
  @UseGuards(JwtAuthGuard)
  historialTerminal(@Param("id") id: string) {
    return this.pagos.historialTerminal(id);
  }

  // --- Solicitudes de pago (POS + APK) -------------------------------------------------------

  @Post("solicitudes")
  @UseGuards(JwtAuthGuard)
  @Audit("PAGO_SOLICITUD", "CREAR")
  crearSolicitud(@Body() dto: CrearSolicitudPagoDto, @CurrentUser() user: any) {
    return this.pagos.crearSolicitud(dto, user.sub);
  }

  @Get("solicitudes/:id")
  @UseGuards(JwtAuthGuard)
  obtener(@Param("id") id: string) {
    return this.pagos.obtener(id);
  }

  @Get("solicitudes")
  @UseGuards(JwtAuthGuard)
  listarPorPedido(@Query("pedidoId") pedidoId: string) {
    return this.pagos.listarPorPedido(pedidoId);
  }

  @Post("solicitudes/:id/iniciar-cobro")
  @UseGuards(JwtAuthGuard)
  @Audit("PAGO_SOLICITUD", "INICIAR_COBRO")
  iniciarCobro(@Param("id") id: string, @CurrentUser() user: any) {
    const origen = user.rol === RolUsuario.MESERO ? OrigenEventoPago.APK : OrigenEventoPago.POS;
    return this.pagos.iniciarCobro(id, origen);
  }

  @Post("solicitudes/:id/cancelar")
  @UseGuards(JwtAuthGuard)
  @Audit("PAGO_SOLICITUD", "CANCELAR")
  cancelar(@Param("id") id: string, @CurrentUser() user: any) {
    const origen = user.rol === RolUsuario.MESERO ? OrigenEventoPago.APK : OrigenEventoPago.POS;
    return this.pagos.cancelarSolicitud(id, origen);
  }

  @Post("solicitudes/:id/consultar-estado")
  @UseGuards(JwtAuthGuard)
  consultarEstado(@Param("id") id: string) {
    return this.pagos.consultarEstado(id);
  }

  // --- Push tokens (APK) ----------------------------------------------------------------------

  @Post("push-tokens")
  @UseGuards(JwtAuthGuard)
  registrarPushToken(@Body() dto: { token: string; dispositivoId?: string; plataforma?: string }, @CurrentUser() user: any) {
    return this.push.registrarToken(user.sub, dto.token, dto.dispositivoId, dto.plataforma);
  }

  // --- Webhooks del proveedor -------------------------------------------------------------------
  // Sin JWT (Mercado Pago no manda uno) — la autenticidad se verifica dentro del adaptador con la
  // firma propia del proveedor (ver mercadopago.adapter.ts -> verificarFirma). La URL incluye el
  // id de PaymentProviderConfig para poder resolver, sin adivinar, con qué cuenta/credenciales
  // verificar esa firma en un sistema multi-empresa/multi-sucursal.

  @Public()
  @Post("webhooks/:configId")
  async webhook(@Param("configId") configId: string, @Req() req: Request, @Headers() headers: Record<string, string>) {
    return this.pagos.manejarWebhook(configId, {
      headers,
      query: req.query as Record<string, string>,
      body: req.body,
    });
  }
}
