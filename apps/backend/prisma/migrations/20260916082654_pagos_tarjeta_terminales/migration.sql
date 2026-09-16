-- CreateEnum
CREATE TYPE "EstadoConexionTerminal" AS ENUM ('CONECTADA', 'DESCONECTADA', 'OCUPADA', 'ERROR');

-- CreateEnum
CREATE TYPE "AmbienteProveedorPago" AS ENUM ('PRUEBAS', 'PRODUCCION');

-- CreateEnum
CREATE TYPE "EstadoSolicitudPago" AS ENUM ('PENDIENTE', 'ENVIADO_A_TERMINAL', 'EN_PROCESO', 'APROBADO', 'RECHAZADO', 'CANCELADO', 'EXPIRADO', 'ERROR');

-- CreateEnum
CREATE TYPE "OrigenEventoPago" AS ENUM ('POS', 'APK', 'PROVEEDOR', 'WEBHOOK', 'SISTEMA');

-- CreateTable
CREATE TABLE "payment_provider_configs" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "sucursalId" TEXT,
    "proveedor" TEXT NOT NULL,
    "ambiente" "AmbienteProveedorPago" NOT NULL DEFAULT 'PRUEBAS',
    "credencialesCifradas" TEXT NOT NULL,
    "identificadorComercio" TEXT,
    "webhookUrl" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_provider_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_terminals" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "cajaId" TEXT,
    "proveedorConfigId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "zona" TEXT,
    "meseroAsignadoId" TEXT,
    "identificadorExterno" TEXT NOT NULL,
    "configuracionCifrada" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "estadoConexion" "EstadoConexionTerminal" NOT NULL DEFAULT 'DESCONECTADA',
    "ultimaSincronizacion" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_terminals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_requests" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "pedidoId" TEXT NOT NULL,
    "mesaId" TEXT,
    "meseroId" TEXT,
    "terminalId" TEXT NOT NULL,
    "proveedor" TEXT NOT NULL,
    "referenciaInterna" TEXT NOT NULL,
    "referenciaExterna" TEXT,
    "importe" DECIMAL(10,2) NOT NULL,
    "moneda" TEXT NOT NULL DEFAULT 'MXN',
    "estado" "EstadoSolicitudPago" NOT NULL DEFAULT 'PENDIENTE',
    "idempotencyKey" TEXT NOT NULL,
    "creadoPorId" TEXT NOT NULL,
    "motivoError" TEXT,
    "expiraEn" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" TEXT NOT NULL,
    "paymentRequestId" TEXT NOT NULL,
    "tipoEvento" TEXT NOT NULL,
    "origen" "OrigenEventoPago" NOT NULL,
    "payloadSanitizado" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_tokens" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "dispositivoId" TEXT,
    "token" TEXT NOT NULL,
    "plataforma" TEXT NOT NULL DEFAULT 'android',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "push_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_provider_configs_empresaId_idx" ON "payment_provider_configs"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_provider_configs_empresaId_sucursalId_proveedor_key" ON "payment_provider_configs"("empresaId", "sucursalId", "proveedor");

-- CreateIndex
CREATE INDEX "payment_terminals_sucursalId_idx" ON "payment_terminals"("sucursalId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_terminals_proveedorConfigId_identificadorExterno_key" ON "payment_terminals"("proveedorConfigId", "identificadorExterno");

-- CreateIndex
CREATE UNIQUE INDEX "payment_requests_referenciaInterna_key" ON "payment_requests"("referenciaInterna");

-- CreateIndex
CREATE UNIQUE INDEX "payment_requests_idempotencyKey_key" ON "payment_requests"("idempotencyKey");

-- CreateIndex
CREATE INDEX "payment_requests_pedidoId_idx" ON "payment_requests"("pedidoId");

-- CreateIndex
CREATE INDEX "payment_requests_terminalId_idx" ON "payment_requests"("terminalId");

-- CreateIndex
CREATE INDEX "payment_requests_estado_idx" ON "payment_requests"("estado");

-- CreateIndex
CREATE INDEX "payment_events_paymentRequestId_idx" ON "payment_events"("paymentRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "push_tokens_token_key" ON "push_tokens"("token");

-- CreateIndex
CREATE INDEX "push_tokens_usuarioId_idx" ON "push_tokens"("usuarioId");

-- AddForeignKey
ALTER TABLE "payment_provider_configs" ADD CONSTRAINT "payment_provider_configs_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_provider_configs" ADD CONSTRAINT "payment_provider_configs_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "sucursales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_terminals" ADD CONSTRAINT "payment_terminals_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_terminals" ADD CONSTRAINT "payment_terminals_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "sucursales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_terminals" ADD CONSTRAINT "payment_terminals_cajaId_fkey" FOREIGN KEY ("cajaId") REFERENCES "cajas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_terminals" ADD CONSTRAINT "payment_terminals_meseroAsignadoId_fkey" FOREIGN KEY ("meseroAsignadoId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_terminals" ADD CONSTRAINT "payment_terminals_proveedorConfigId_fkey" FOREIGN KEY ("proveedorConfigId") REFERENCES "payment_provider_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "sucursales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "pedidos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_mesaId_fkey" FOREIGN KEY ("mesaId") REFERENCES "mesas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_meseroId_fkey" FOREIGN KEY ("meseroId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "payment_terminals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_paymentRequestId_fkey" FOREIGN KEY ("paymentRequestId") REFERENCES "payment_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
