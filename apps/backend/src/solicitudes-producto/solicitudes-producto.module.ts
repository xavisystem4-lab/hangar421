import { Module } from "@nestjs/common";
import { SolicitudesProductoController } from "./solicitudes-producto.controller";
import { SolicitudesProductoService } from "./solicitudes-producto.service";

@Module({
  controllers: [SolicitudesProductoController],
  providers: [SolicitudesProductoService],
  exports: [SolicitudesProductoService],
})
export class SolicitudesProductoModule {}
