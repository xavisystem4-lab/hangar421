import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CifradoService } from "../common/crypto/cifrado.service";
import { CIFRADO_CORREO, CorreoService } from "./correo.service";
import { CorreoController } from "./correo.controller";

/**
 * Envío de correo del ERP (ver CorreoService) y su configuración desde Admin → Correo. Global:
 * cualquier módulo (inventario, por ahora) lo inyecta sin importarlo.
 *
 * La contraseña SMTP se cifra con CORREO_CIFRADO_KEY; si esa variable no existe se reutiliza
 * PAGOS_CIFRADO_KEY (que ya es obligatoria en todo despliegue) para no exigir una variable nueva.
 */
@Global()
@Module({
  controllers: [CorreoController],
  providers: [
    CorreoService,
    {
      provide: CIFRADO_CORREO,
      useFactory: (config: ConfigService) => new CifradoService(config, config.get<string>("CORREO_CIFRADO_KEY") ? "CORREO_CIFRADO_KEY" : "PAGOS_CIFRADO_KEY"),
      inject: [ConfigService],
    },
  ],
  exports: [CorreoService],
})
export class CorreoModule {}
