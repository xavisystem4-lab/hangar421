import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { RolUsuario, TipoMovimientoInventario } from "@hangar421/shared";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { Audit } from "../common/interceptors/audit.interceptor";
import { InventarioService, type ReporteInventarioPorCorreo } from "./inventario.service";

@ApiTags("inventario")
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("inventario")
export class InventarioController {
  constructor(private inventario: InventarioService) {}

  @Get("insumos")
  listarInsumos(@Query("empresaId") empresaId: string) {
    return this.inventario.listarInsumos(empresaId);
  }

  @Post("insumos")
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL)
  @Audit("INSUMO", "CREAR")
  crearInsumo(@Body() body: any) {
    return this.inventario.crearInsumo(body);
  }

  // También usado para "eliminar" (baja lógica, { activo: false }) — nunca se borra el
  // registro en sí: conserva el historial de movimientos/receta que ya lo referencian.
  @Patch("insumos/:id")
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL)
  @Audit("INSUMO", "ACTUALIZAR")
  actualizarInsumo(@Param("id") id: string, @Body() body: any) {
    return this.inventario.actualizarInsumo(id, body);
  }

  @Post("productos/:id/receta")
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL)
  @Audit("RECETA", "DEFINIR")
  definirReceta(@Param("id") id: string, @Body("items") items: { insumoId: string; cantidad: number }[]) {
    return this.inventario.definirReceta(id, items);
  }

  @Get("productos/:id/receta")
  listarReceta(@Param("id") id: string) {
    return this.inventario.listarReceta(id);
  }

  @Delete("receta/:recetaItemId")
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL)
  @Audit("RECETA", "ELIMINAR_ITEM")
  eliminarItemReceta(@Param("recetaItemId") recetaItemId: string) {
    return this.inventario.eliminarItemReceta(recetaItemId);
  }

  @Get("existencias")
  existencias(@Query("sucursalId") sucursalId: string) {
    return this.inventario.existencias(sucursalId);
  }

  /** Existencia "en producto": cuántas unidades de cada producto alcanzan con los insumos de la sucursal. */
  @Get("productos-existencias")
  existenciasPorProducto(@Query("sucursalId") sucursalId: string) {
    return this.inventario.existenciasPorProducto(sucursalId);
  }

  /** Si el servidor puede enviar correos (para que el ERP ofrezca "Enviar por correo" o la alternativa manual). */
  @Get("reporte/correo")
  estadoCorreo(@Query("sucursalId") sucursalId?: string) {
    return this.inventario.estadoCorreo(sucursalId);
  }

  @Post("reporte/enviar")
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL, RolUsuario.SUPERVISOR)
  @Audit("INVENTARIO", "ENVIAR_REPORTE")
  enviarReporte(@Body() body: ReporteInventarioPorCorreo, @Req() req: { user?: { nombre?: string; email?: string } }) {
    return this.inventario.enviarReportePorCorreo(body, req.user?.nombre ?? req.user?.email);
  }

  @Get("alertas")
  alertas(@Query("sucursalId") sucursalId: string) {
    return this.inventario.alertasStockBajo(sucursalId);
  }

  @Post("movimientos")
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL, RolUsuario.SUPERVISOR, RolUsuario.CAJERO)
  @Audit("MOVIMIENTO_INVENTARIO", "REGISTRAR")
  registrarMovimiento(@Body() body: { sucursalId: string; insumoId: string; tipo: TipoMovimientoInventario; cantidad: number; motivo?: string; usuarioId?: string; dispositivoId?: string; idempotencyKey?: string }) {
    return this.inventario.registrarMovimiento(body);
  }

  @Post("minimos")
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL)
  fijarMinimo(@Body() body: { sucursalId: string; insumoId: string; minimo: number; maximo?: number }) {
    return this.inventario.fijarMinimo(body.sucursalId, body.insumoId, body.minimo, body.maximo);
  }

  @Get("movimientos")
  listarMovimientos(@Query("sucursalId") sucursalId: string, @Query("insumoId") insumoId?: string) {
    return this.inventario.listarMovimientos(sucursalId, insumoId);
  }
}
