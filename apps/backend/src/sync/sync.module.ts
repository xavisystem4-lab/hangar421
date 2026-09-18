import { Module } from "@nestjs/common";
import { PedidosModule } from "../pedidos/pedidos.module";
import { MesasModule } from "../mesas/mesas.module";
import { InventarioModule } from "../inventario/inventario.module";
import { CajaModule } from "../caja/caja.module";
import { CatalogoModule } from "../catalogo/catalogo.module";
import { SyncController } from "./sync.controller";
import { SyncService } from "./sync.service";

@Module({
  imports: [PedidosModule, MesasModule, InventarioModule, CajaModule, CatalogoModule],
  controllers: [SyncController],
  providers: [SyncService],
})
export class SyncModule {}
