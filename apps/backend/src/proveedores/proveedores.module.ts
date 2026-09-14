import { Module } from "@nestjs/common";
import { ProveedoresController } from "./proveedores.controller";
import { ProveedoresService } from "./proveedores.service";

@Module({
  controllers: [ProveedoresController],
  providers: [ProveedoresService],
  exports: [ProveedoresService],
})
export class ProveedoresModule {}
