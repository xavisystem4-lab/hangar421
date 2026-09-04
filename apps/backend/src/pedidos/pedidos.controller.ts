import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
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

  @Post(":id/descuentos")
  @Roles(RolUsuario.SUPERVISOR, RolUsuario.ADMIN_SUCURSAL, RolUsuario.ADMIN_CORPORATIVO)
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

  @Post(":id/cancelar")
  @Roles(RolUsuario.SUPERVISOR, RolUsuario.ADMIN_SUCURSAL, RolUsuario.ADMIN_CORPORATIVO)
  @Audit("PEDIDO", "CANCELAR")
  cancelar(@Param("id") id: string, @Body() dto: CancelarPedidoDto) {
    return this.pedidos.cancelar(id, dto.motivo, dto.autorizadoPorId);
  }
}
