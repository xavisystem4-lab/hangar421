import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtStrategy } from "./jwt.strategy";
import { VinculacionService } from "./vinculacion.service";
import { TerminalController } from "./terminal.controller";
import { TerminalService } from "./terminal.service";

@Module({
  imports: [PassportModule, JwtModule.register({})],
  controllers: [AuthController, TerminalController],
  providers: [AuthService, VinculacionService, TerminalService, JwtStrategy],
  exports: [AuthService, VinculacionService],
})
export class AuthModule {}
