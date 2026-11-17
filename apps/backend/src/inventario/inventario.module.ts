import { Module } from "@nestjs/common";
import { InventarioController } from "./inventario.controller";
import { InventarioService } from "./inventario.service";
import { ComprasController } from "./compras.controller";
import { ComprasService } from "./compras.service";

@Module({
  controllers: [ComprasController, InventarioController],
  providers: [InventarioService, ComprasService],
  exports: [InventarioService],
})
export class InventarioModule {}
