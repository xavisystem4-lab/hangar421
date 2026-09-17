-- CreateEnum
CREATE TYPE "AmbientePlataforma" AS ENUM ('SANDBOX', 'PRODUCCION');

-- CreateEnum
CREATE TYPE "EstadoConexionPlataforma" AS ENUM ('CONECTADA', 'DESCONECTADA', 'PENDIENTE_CONFIGURACION', 'ERROR');

-- CreateEnum
CREATE TYPE "EstadoSincronizacionOrdenPlataforma" AS ENUM ('RECIBIDA', 'SINCRONIZADA', 'ERROR', 'IGNORADA');

-- CreateTable
CREATE TABLE "plataforma_configs" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "sucursalId" TEXT,
    "plataforma" TEXT NOT NULL,
    "ambiente" "AmbientePlataforma" NOT NULL DEFAULT 'SANDBOX',
    "activo" BOOLEAN NOT NULL DEFAULT false,
    "estadoConexion" "EstadoConexionPlataforma" NOT NULL DEFAULT 'PENDIENTE_CONFIGURACION',
    "credencialesCifradas" TEXT,
    "credencialesUltimos4" TEXT,
    "clientSecretConfigurado" BOOLEAN NOT NULL DEFAULT false,
    "identificadorTienda" TEXT,
    "webhookSlug" TEXT NOT NULL,
    "ultimaSincronizacion" TIMESTAMP(3),
    "ultimoErrorMensaje" TEXT,
    "ultimoErrorEn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plataforma_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plataforma_webhook_events" (
    "id" TEXT NOT NULL,
    "plataformaConfigId" TEXT NOT NULL,
    "eventoExternoId" TEXT NOT NULL,
    "tipoEvento" TEXT NOT NULL,
    "payloadSanitizado" JSONB,
    "procesadoOk" BOOLEAN NOT NULL DEFAULT true,
    "motivoError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plataforma_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plataforma_orden_syncs" (
    "id" TEXT NOT NULL,
    "plataformaConfigId" TEXT NOT NULL,
    "ordenExternaId" TEXT NOT NULL,
    "estado" "EstadoSincronizacionOrdenPlataforma" NOT NULL DEFAULT 'RECIBIDA',
    "pedidoId" TEXT,
    "motivoError" TEXT,
    "payloadSanitizado" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plataforma_orden_syncs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plataforma_configs_webhookSlug_key" ON "plataforma_configs"("webhookSlug");

-- CreateIndex
CREATE INDEX "plataforma_configs_empresaId_idx" ON "plataforma_configs"("empresaId");

-- CreateIndex
CREATE INDEX "plataforma_configs_sucursalId_idx" ON "plataforma_configs"("sucursalId");

-- CreateIndex
CREATE UNIQUE INDEX "plataforma_configs_empresaId_sucursalId_plataforma_key" ON "plataforma_configs"("empresaId", "sucursalId", "plataforma");

-- CreateIndex
CREATE INDEX "plataforma_webhook_events_plataformaConfigId_createdAt_idx" ON "plataforma_webhook_events"("plataformaConfigId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "plataforma_webhook_events_plataformaConfigId_eventoExtern_key" ON "plataforma_webhook_events"("plataformaConfigId", "eventoExternoId");

-- CreateIndex
CREATE INDEX "plataforma_orden_syncs_plataformaConfigId_estado_idx" ON "plataforma_orden_syncs"("plataformaConfigId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "plataforma_orden_syncs_plataformaConfigId_ordenExternaId_key" ON "plataforma_orden_syncs"("plataformaConfigId", "ordenExternaId");

-- AddForeignKey
ALTER TABLE "plataforma_configs" ADD CONSTRAINT "plataforma_configs_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plataforma_configs" ADD CONSTRAINT "plataforma_configs_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "sucursales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plataforma_webhook_events" ADD CONSTRAINT "plataforma_webhook_events_plataformaConfigId_fkey" FOREIGN KEY ("plataformaConfigId") REFERENCES "plataforma_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plataforma_orden_syncs" ADD CONSTRAINT "plataforma_orden_syncs_plataformaConfigId_fkey" FOREIGN KEY ("plataformaConfigId") REFERENCES "plataforma_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plataforma_orden_syncs" ADD CONSTRAINT "plataforma_orden_syncs_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "pedidos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
