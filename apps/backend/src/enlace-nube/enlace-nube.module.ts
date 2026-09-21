import { Module } from "@nestjs/common";
import { EnlaceNubeController } from "./enlace-nube.controller";
import { EnlaceNubeService } from "./enlace-nube.service";

@Module({
  controllers: [EnlaceNubeController],
  providers: [EnlaceNubeService],
})
export class EnlaceNubeModule {}
