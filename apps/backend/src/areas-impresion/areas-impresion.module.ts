import { Module } from "@nestjs/common";
import { AreasImpresionController } from "./areas-impresion.controller";
import { AreasImpresionService } from "./areas-impresion.service";

@Module({
  controllers: [AreasImpresionController],
  providers: [AreasImpresionService],
})
export class AreasImpresionModule {}
