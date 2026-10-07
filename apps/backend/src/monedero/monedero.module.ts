import { Module } from "@nestjs/common";
import { MonederoController } from "./monedero.controller";
import { MonederoService } from "./monedero.service";

@Module({
  controllers: [MonederoController],
  providers: [MonederoService],
})
export class MonederoModule {}
