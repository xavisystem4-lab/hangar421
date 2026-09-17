import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PedidosModule } from "../pedidos/pedidos.module";
import { CifradoService } from "../common/crypto/cifrado.service";
import { CIFRADO_PLATAFORMAS } from "./plataformas.tokens";
import { PlataformasController } from "./plataformas.controller";
import { PlataformasService } from "./plataformas.service";
import { PlataformaDeliveryRegistry } from "./proveedores/plataforma-delivery.registry";
import { DidiAdapter } from "./proveedores/didi.adapter";
import { UberAdapter } from "./proveedores/uber.adapter";
import { RappiAdapter } from "./proveedores/rappi.adapter";
import { MockPlataformaAdapter } from "./proveedores/mock.adapter";

@Module({
  imports: [PedidosModule],
  controllers: [PlataformasController],
  providers: [
    PlataformasService,
    PlataformaDeliveryRegistry,
    DidiAdapter,
    UberAdapter,
    RappiAdapter,
    MockPlataformaAdapter,
    {
      // Llave de cifrado propia del dominio "plataformas" (PLATAFORMAS_CIFRADO_KEY), distinta de
      // la de pagos — ver common/crypto/cifrado.service.ts.
      provide: CIFRADO_PLATAFORMAS,
      useFactory: (config: ConfigService) => new CifradoService(config, "PLATAFORMAS_CIFRADO_KEY"),
      inject: [ConfigService],
    },
  ],
})
export class PlataformasModule {}
