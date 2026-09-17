import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PedidosModule } from "../pedidos/pedidos.module";
import { CifradoService } from "../common/crypto/cifrado.service";
import { PagosController } from "./pagos.controller";
import { PagosService } from "./pagos.service";
import { PushService } from "./push.service";
import { MercadoPagoAdapter } from "./proveedores/mercadopago.adapter";
import { MockPagoAdapter } from "./proveedores/mock.adapter";
import { ProveedorPagoRegistry } from "./proveedores/proveedor-pago.registry";

@Module({
  imports: [PedidosModule],
  controllers: [PagosController],
  providers: [PagosService, PushService, {
          provide: CifradoService,
          useFactory: (config: ConfigService) => new CifradoService(config),
          inject: [ConfigService],
  }, ProveedorPagoRegistry, MercadoPagoAdapter, MockPagoAdapter],
  exports: [PagosService],
})
export class PagosModule {}
