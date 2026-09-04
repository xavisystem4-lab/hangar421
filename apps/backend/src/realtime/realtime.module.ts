import { Global, Module } from "@nestjs/common";
import { RealtimeGateway } from "./realtime.gateway";
import { RealtimeController } from "./realtime.controller";

@Global()
@Module({
  controllers: [RealtimeController],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
