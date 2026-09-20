import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SucursalesController } from "./sucursales.controller";
import { SucursalesService } from "./sucursales.service";

@Module({
  // AuthModule por verificarAutorizacion: renombrar desde una terminal se autoriza con la
  // contraseña de un administrador, no con el rol de la sesión (ver renombrarDesdeTerminal).
  imports: [AuthModule],
  controllers: [SucursalesController],
  providers: [SucursalesService],
  exports: [SucursalesService],
})
export class SucursalesModule {}
