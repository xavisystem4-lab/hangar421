import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";

import { PrismaModule } from "./prisma/prisma.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { AuthModule } from "./auth/auth.module";
import { EmpresasModule } from "./empresas/empresas.module";
import { SucursalesModule } from "./sucursales/sucursales.module";
import { UsuariosModule } from "./usuarios/usuarios.module";
import { CatalogoModule } from "./catalogo/catalogo.module";
import { MesasModule } from "./mesas/mesas.module";
import { PedidosModule } from "./pedidos/pedidos.module";
import { CocinaModule } from "./cocina/cocina.module";
import { CajaModule } from "./caja/caja.module";
import { InventarioModule } from "./inventario/inventario.module";
import { TraspasosModule } from "./traspasos/traspasos.module";
import { ClientesModule } from "./clientes/clientes.module";
import { ReportesModule } from "./reportes/reportes.module";
import { SyncModule } from "./sync/sync.module";

import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { RolesGuard } from "./common/guards/roles.guard";
import { AllExceptionsFilter } from "./common/filters/http-exception.filter";
import { AuditInterceptor } from "./common/interceptors/audit.interceptor";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 120 }] }),
    PrismaModule,
    RealtimeModule,
    AuthModule,
    EmpresasModule,
    SucursalesModule,
    UsuariosModule,
    CatalogoModule,
    MesasModule,
    PedidosModule,
    CocinaModule,
    CajaModule,
    InventarioModule,
    TraspasosModule,
    ClientesModule,
    ReportesModule,
    SyncModule,
  ],
  providers: [
    // Orden: JWT primero, luego roles — ambos globales; @Public() los sortea.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
