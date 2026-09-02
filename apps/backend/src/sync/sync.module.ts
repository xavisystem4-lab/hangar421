import { Module } from "@nestjs/common";
import { PedidosModule } from "../pedidos/pedidos.module";
import { MesasModule } from "../mesas/mesas.module";
import { InventarioModule } from "../inventario/inventario.module";
import { CajaModule } from "../caja/caja.module";
import { SyncController } from "./sync.controller";
import { SyncService } from "./sync.service";

@Module({
  imports: [PedidosModule, MesasModule, InventarioModule, CajaModule],
  controllers: [SyncController],
  providers: [SyncService],
})
export class SyncModule {}
