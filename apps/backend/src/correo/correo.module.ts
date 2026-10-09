import { Global, Module } from "@nestjs/common";
import { CorreoService } from "./correo.service";

/** Envío de correo del ERP (ver CorreoService). Global: cualquier módulo lo inyecta sin importarlo. */
@Global()
@Module({
  providers: [CorreoService],
  exports: [CorreoService],
})
export class CorreoModule {}
