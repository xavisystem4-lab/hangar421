import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { EstadoPedido, EstadoPedidoItem, RolUsuario } from "@hangar421/shared";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { Audit } from "../common/interceptors/audit.interceptor";
import { PedidosService } from "./pedidos.service";
import {
  AgregarItemsDto,
  AplicarDescuentoDto,
  CancelarPedidoDto,
  CobrarPedidoDto,
  CrearPedidoDto,
} from "./dto/pedido.dto";

@ApiTags("pedidos")
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("pedidos")
export class PedidosController {
  constructor(private pedidos: PedidosService) {}

  @Get()
  listar(
    @Query("sucursalId") sucursalId: string,
    @Query("estado") estado?: EstadoPedido,
    /** Lista separada por comas, ej. "ENVIADO,EN_PREPARACION,LISTO" — la usa el POS para la
     *  cola de "Pedidos por cobrar" (ver pedidos.service.ts `listar`). */
    @Query("estados") estadosCsv?: string,
  ) {
    const estados = estadosCsv ? (estadosCsv.split(",") as EstadoPedido[]) : undefined;
    return this.pedidos.listar(sucursalId, estado, estados);
  }

  /**
   * Consulta de ventas del ERP (módulo Ventas y tarjetas del dashboard).
   *
   * Va ANTES que `@Get(":id")`: Nest resuelve por orden de declaración y si no, `:id` capturaría
   * la cadena "ventas".
   *
   * `empresaId` sale del token, nunca del query: es lo que impide pedir las ventas de otra
   * empresa. `sucursalId` sí viene por query —es la sucursal elegida en el ERP— y
   * SucursalAccessGuard lo compara contra la sesión, así que un usuario de una sucursal no puede
   * consultar la otra. Omitirlo da el consolidado, y solo ADMIN_CORPORATIVO pasa el guard sin él.
   */
  @Get("ventas")
  consultarVentas(
    @Req() req: any,
    @Query("sucursalId") sucursalId?: string,
    @Query("desde") desde?: string,
    @Query("hasta") hasta?: string,
    @Query("estado") estado?: EstadoPedido,
    @Query("busqueda") busqueda?: string,
    @Query("limite") limite?: string,
    @Query("offset") offset?: string,
  ) {
    return this.pedidos.consultarVentas(req.user.empresaId, {
      sucursalId,
      desde,
      hasta,
      estado,
      busqueda,
      limite: limite ? Number(limite) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Get(":id")
  obtener(@Param("id") id: string) {
    return this.pedidos.obtener(id);
  }

  @Post()
  @Audit("PEDIDO", "CREAR")
  crear(@Body() dto: CrearPedidoDto) {
    return this.pedidos.crear(dto);
  }

  @Post(":id/items")
  @Audit("PEDIDO", "AGREGAR_ITEMS")
  agregarItems(@Param("id") id: string, @Body() dto: AgregarItemsDto) {
    return this.pedidos.agregarItems(id, dto);
  }

  @Post(":id/enviar-cocina")
  @Audit("PEDIDO", "ENVIAR_COCINA")
  enviarACocina(@Param("id") id: string) {
    return this.pedidos.enviarACocina(id);
  }

  @Patch(":id/items/:itemId/estado")
  @Roles(RolUsuario.COCINA, RolUsuario.ADMIN_SUCURSAL, RolUsuario.SUPERVISOR)
  cambiarEstadoItem(
    @Param("id") id: string,
    @Param("itemId") itemId: string,
    @Body("estado") estado: EstadoPedidoItem,
  ) {
    return this.pedidos.cambiarEstadoItem(id, itemId, estado);
  }

  // Sin @Roles: mismo criterio que cancelar() — la autorización real es la contraseña de
  // `autorizadoPorId`, verificada server-side dentro de PedidosService.aplicarDescuento.
  @Post(":id/descuentos")
  @Audit("PEDIDO", "APLICAR_DESCUENTO")
  aplicarDescuento(@Param("id") id: string, @Body() dto: AplicarDescuentoDto) {
    return this.pedidos.aplicarDescuento(id, dto);
  }

  @Post(":id/cobrar")
  @Roles(RolUsuario.CAJERO, RolUsuario.ADMIN_SUCURSAL, RolUsuario.ADMIN_CORPORATIVO)
  @Audit("PEDIDO", "COBRAR")
  cobrar(@Param("id") id: string, @Body() dto: CobrarPedidoDto) {
    return this.pedidos.cobrar(id, dto);
  }

  // Sin @Roles: alcanzable desde cualquier sesión del POS (cajero incluido) — la autorización
  // real es el PIN de supervisor/admin, verificado server-side dentro de PedidosService.cancelar
  // (ver AuthService.verificarAutorizacion). Restringir esto por el rol de la sesión activa
  // haría que un cajero nunca pudiera cancelar una cuenta aunque tuviera el PIN correcto.
  @Post(":id/cancelar")
  @Audit("PEDIDO", "CANCELAR")
  cancelar(@Param("id") id: string, @Body() dto: CancelarPedidoDto) {
    return this.pedidos.cancelar(id, dto.motivo, dto.autorizadoPorId, dto.password);
  }
}
