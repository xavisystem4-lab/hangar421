import { Body, Controller, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { RolUsuario } from "@hangar421/shared";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { Audit } from "../common/interceptors/audit.interceptor";
import { CatalogoService } from "./catalogo.service";

@ApiTags("catalogo")
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("catalogo")
export class CatalogoController {
  constructor(private catalogo: CatalogoService) {}

  @Get("categorias")
  listarCategorias(@Query("empresaId") empresaId: string) {
    return this.catalogo.listarCategorias(empresaId);
  }

  @Post("categorias")
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL)
  @Audit("CATEGORIA", "CREAR")
  crearCategoria(@Body() body: any) {
    return this.catalogo.crearCategoria(body);
  }

  @Get("productos")
  listarProductos(@Query("empresaId") empresaId: string, @Query("sucursalId") sucursalId: string) {
    return this.catalogo.listarProductosPorSucursal(empresaId, sucursalId);
  }

  @Post("productos")
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL)
  @Audit("PRODUCTO", "CREAR")
  crearProducto(@Req() req: any, @Body() body: any) {
    // La empresa sale del token: un admin nunca da de alta productos en otra empresa.
    return this.catalogo.crearProducto({ ...body, empresaId: req.user.empresaId });
  }

  /** Reemplaza la lista de modificadores que pregunta un producto (ERP → Catálogo → Editar). */
  @Put("productos/:id/modificadores")
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL)
  @Audit("PRODUCTO", "ACTUALIZAR_MODIFICADORES")
  fijarModificadores(@Req() req: any, @Param("id") id: string, @Body() body: { modificadorIds?: string[] }) {
    return this.catalogo.fijarModificadoresDeProducto(req.user.empresaId, id, body?.modificadorIds);
  }

  @Patch("productos/:id")
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL)
  @Audit("PRODUCTO", "ACTUALIZAR")
  actualizarProducto(@Param("id") id: string, @Body() body: any) {
    return this.catalogo.actualizarProducto(id, body);
  }

  @Patch("productos/:id/precio-sucursal")
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL)
  @Audit("PRODUCTO_SUCURSAL", "ACTUALIZAR_PRECIO")
  fijarPrecio(
    @Param("id") id: string,
    @Body() body: { sucursalId: string; precio: number; disponible?: boolean },
  ) {
    return this.catalogo.fijarPrecioSucursal(id, body.sucursalId, body.precio, body.disponible);
  }

  @Patch("productos/:id/disponibilidad")
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL, RolUsuario.SUPERVISOR)
  @Audit("PRODUCTO_SUCURSAL", "ACTUALIZAR_DISPONIBILIDAD")
  fijarDisponibilidad(@Param("id") id: string, @Body() body: { sucursalId: string; disponible: boolean }) {
    return this.catalogo.fijarDisponibilidad(id, body.sucursalId, body.disponible);
  }

  /** Promociones de la empresa del usuario autenticado (la empresa sale del token, no de la URL). */
  @Get("promociones")
  listarPromociones(@Req() req: any) {
    return this.catalogo.listarPromociones(req.user.empresaId);
  }

  @Get("modificadores")
  listarModificadores(@Query("empresaId") empresaId: string) {
    return this.catalogo.listarModificadores(empresaId);
  }

  @Post("modificadores")
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL)
  @Audit("MODIFICADOR", "CREAR")
  crearModificador(@Body() body: any) {
    return this.catalogo.crearModificador(body);
  }

  @Post("productos/:id/modificadores/:modificadorId")
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL)
  asignarModificador(@Param("id") id: string, @Param("modificadorId") modificadorId: string) {
    return this.catalogo.asignarModificadorAProducto(id, modificadorId);
  }
}
