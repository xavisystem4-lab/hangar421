import { Module } from "@nestjs/common";
import { InventarioModule } from "../inventario/inventario.module";
import { TraspasosController } from "./traspasos.controller";
import { TraspasosService } from "./traspasos.service";

@Module({
  imports: [InventarioModule],
  controllers: [TraspasosController],
  providers: [TraspasosService],
})
export class TraspasosModule {}
