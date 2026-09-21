import { Module } from "@nestjs/common";
import { PedidosModule } from "../pedidos/pedidos.module";
import { MesasModule } from "../mesas/mesas.module";
import { InventarioModule } from "../inventario/inventario.module";
import { CajaModule } from "../caja/caja.module";
import { CatalogoModule } from "../catalogo/catalogo.module";
import { SolicitudesProductoModule } from "../solicitudes-producto/solicitudes-producto.module";
import { SyncController } from "./sync.controller";
import { SyncService } from "./sync.service";
import { ImportacionHubService } from "./importacion-hub.service";

@Module({
  imports: [PedidosModule, MesasModule, InventarioModule, CajaModule, CatalogoModule, SolicitudesProductoModule],
  controllers: [SyncController],
  providers: [SyncService, ImportacionHubService],
})
export class SyncModule {}
