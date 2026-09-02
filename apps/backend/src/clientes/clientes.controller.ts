import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { ClientesService } from "./clientes.service";

@ApiTags("clientes")
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("clientes")
export class ClientesController {
  constructor(private clientes: ClientesService) {}

  @Get()
  listar(@Query("empresaId") empresaId: string, @Query("q") q?: string) {
    return this.clientes.listar(empresaId, q);
  }

  @Post()
  crear(@Body() body: any) {
    return this.clientes.crear(body);
  }

  @Get(":id/historial")
  historial(@Param("id") id: string) {
    return this.clientes.historialCompras(id);
  }
}
