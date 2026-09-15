import { Module } from "@nestjs/common";
import { PerfilesController } from "./perfiles.controller";
import { PerfilesService } from "./perfiles.service";

@Module({
  controllers: [PerfilesController],
  providers: [PerfilesService],
  exports: [PerfilesService],
})
export class PerfilesModule {}
