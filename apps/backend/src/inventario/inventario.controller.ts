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

  /** Con `sucursalId`, solo los insumos que maneja esa sucursal. */
  @Get("insumos")
  listarInsumos(@Query("empresaId") empresaId: string, @Query("sucursalId") sucursalId?: string) {
    return this.inventario.listarInsumos(empresaId, sucursalId || undefined);
  }

  /** Se crea en la sucursal del cuerpo (la elegida en el ERP) o, si no viene, en la de la sesión. */
  @Post("insumos")
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL)
  @Audit("INSUMO", "CREAR")
  crearInsumo(@Body() body: any, @Req() req: any) {
    return this.inventario.crearInsumo({ ...body, sucursalId: body?.sucursalId ?? req.user?.sucursalId ?? undefined });
  }

  /** La sucursal empieza a manejar un insumo que ya existe en la empresa. */
  @Post("insumos/:id/sucursales/:sucursalId")
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL)
  @Audit("INSUMO", "AGREGAR_A_SUCURSAL")
  agregarASucursal(@Param("id") id: string, @Param("sucursalId") sucursalId: string) {
    return this.inventario.agregarASucursal(sucursalId, id);
  }

  /** Deja de verse en esa sucursal (solo con existencia 0). */
  @Delete("insumos/:id/sucursales/:sucursalId")
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL)
  @Audit("INSUMO", "QUITAR_DE_SUCURSAL")
  quitarDeSucursal(@Param("id") id: string, @Param("sucursalId") sucursalId: string) {
    return this.inventario.quitarDeSucursal(sucursalId, id);
  }

  // También usado para "eliminar" (baja lógica, { activo: false }) — nunca se borra el
  // registro en sí: conserva el historial de movimientos/receta que ya lo referencian.
  @Patch("insumos/:id")
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL)
  @Audit("INSUMO", "ACTUALIZAR")
  actualizarInsumo(@Param("id") id: string, @Body() body: any) {
    return this.inventario.actualizarInsumo(id, body);
  }

  /** Cambia la unidad de un insumo; con `convertir` reescala existencias, mínimos y recetas. */
  @Post("insumos/:id/unidad")
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL)
  @Audit("INSUMO", "CAMBIAR_UNIDAD")
  cambiarUnidad(@Param("id") id: string, @Body() body: { unidadMedida: string; convertir?: boolean }) {
    return this.inventario.cambiarUnidadMedida(id, body?.unidadMedida, body?.convertir ?? true);
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

  /** Todas las recetas de la empresa (producto y opciones): el POS terminal las guarda para
   *  descontar el inventario al cobrar aunque esté sin conexión. */
  @Get("recetas")
  recetasDeEmpresa(@Query("empresaId") empresaId: string) {
    return this.inventario.recetasDeEmpresa(empresaId);
  }

  /** Receta de una opción de modificador (ej. "Leche de avena" → 240 ml de Leche-Avena). */
  @Get("opciones/:opcionId/receta")
  listarRecetaOpcion(@Param("opcionId") opcionId: string) {
    return this.inventario.listarRecetaOpcion(opcionId);
  }

  @Post("opciones/:opcionId/receta")
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL)
  @Audit("RECETA_OPCION", "DEFINIR")
  definirRecetaOpcion(@Param("opcionId") opcionId: string, @Body("items") items: { insumoId: string; cantidad: number }[]) {
    return this.inventario.definirRecetaOpcion(opcionId, items);
  }

  /** Receta de una preparación de la casa (cold foam), por UNA unidad de la preparación. */
  @Get("preparaciones/:id/receta")
  listarRecetaPreparacion(@Param("id") id: string) {
    return this.inventario.listarRecetaPreparacion(id);
  }

  @Post("preparaciones/:id/receta")
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL)
  @Audit("RECETA_PREPARACION", "DEFINIR")
  definirRecetaPreparacion(@Param("id") id: string, @Body("items") items: { insumoId: string; cantidad: number }[]) {
    return this.inventario.definirRecetaPreparacion(id, items);
  }

  /** Todas las opciones de los modificadores de un producto con su receta, para el ERP. */
  @Get("productos/:id/receta-modificadores")
  recetaModificadores(@Param("id") id: string) {
    return this.inventario.recetaDeModificadoresDeProducto(id);
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
