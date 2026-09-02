import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { ReportesService } from "./reportes.service";

@ApiTags("reportes")
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("reportes")
export class ReportesController {
  constructor(private reportes: ReportesService) {}

  @Get("dashboard")
  dashboard(@Query("empresaId") empresaId: string, @Query("sucursalId") sucursalId?: string) {
    return this.reportes.dashboard(empresaId, sucursalId);
  }

  @Get("ventas-por-hora")
  ventasPorHora(@Query("sucursalId") sucursalId: string, @Query("fecha") fecha?: string) {
    return this.reportes.ventasPorHora(sucursalId, fecha);
  }

  @Get("ventas-por-producto")
  ventasPorProducto(@Query("empresaId") empresaId: string, @Query("desde") desde: string, @Query("hasta") hasta: string) {
    return this.reportes.ventasPorProducto(empresaId, new Date(desde), new Date(hasta));
  }

  @Get("ventas-por-metodo-pago")
  ventasPorMetodoPago(@Query("sucursalId") sucursalId: string, @Query("desde") desde: string, @Query("hasta") hasta: string) {
    return this.reportes.ventasPorMetodoPago(sucursalId, new Date(desde), new Date(hasta));
  }
}
