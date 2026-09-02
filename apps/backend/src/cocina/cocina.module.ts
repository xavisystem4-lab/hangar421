import { Module } from "@nestjs/common";
import { CocinaController } from "./cocina.controller";
import { CocinaService } from "./cocina.service";

@Module({
  controllers: [CocinaController],
  providers: [CocinaService],
})
export class CocinaModule {}
