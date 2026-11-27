-- Historial de compras de insumos: cada compra conserva su propio costo (nunca se sobrescribe).
-- CreateEnum
CREATE TYPE "EstadoCompraInsumo" AS ENUM ('VIGENTE', 'ANULADA');

-- CreateTable
CREATE TABLE "compras_insumo" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "insumoId" TEXT NOT NULL,
    "proveedorId" TEXT,
    "fechaCompra" TIMESTAMP(3) NOT NULL,
    "unidadCaptura" TEXT NOT NULL,
    "cantidadCaptura" DECIMAL(12,4) NOT NULL,
    "factor" DECIMAL(14,4) NOT NULL,
    "precioCaptura" DECIMAL(12,4) NOT NULL,
    "cantidadBase" DECIMAL(14,4) NOT NULL,
    "costoUnitario" DECIMAL(14,6) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "notas" TEXT,
    "usuarioId" TEXT,
    "usuarioNombre" TEXT,
    "movimientoId" TEXT,
    "idempotencyKey" TEXT,
    "estado" "EstadoCompraInsumo" NOT NULL DEFAULT 'VIGENTE',
    "anuladaAt" TIMESTAMP(3),
    "anuladaPorId" TEXT,
    "anuladaPorNombre" TEXT,
    "motivoAnulacion" TEXT,
    "movimientoAnulacionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compras_insumo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "compras_insumo_movimientoId_key" ON "compras_insumo"("movimientoId");

-- CreateIndex
CREATE UNIQUE INDEX "compras_insumo_idempotencyKey_key" ON "compras_insumo"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "compras_insumo_movimientoAnulacionId_key" ON "compras_insumo"("movimientoAnulacionId");

-- CreateIndex
CREATE INDEX "compras_insumo_empresaId_fechaCompra_idx" ON "compras_insumo"("empresaId", "fechaCompra");

-- CreateIndex
CREATE INDEX "compras_insumo_insumoId_fechaCompra_idx" ON "compras_insumo"("insumoId", "fechaCompra");

-- CreateIndex
CREATE INDEX "compras_insumo_sucursalId_fechaCompra_idx" ON "compras_insumo"("sucursalId", "fechaCompra");

-- AddForeignKey
ALTER TABLE "compras_insumo" ADD CONSTRAINT "compras_insumo_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "sucursales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compras_insumo" ADD CONSTRAINT "compras_insumo_insumoId_fkey" FOREIGN KEY ("insumoId") REFERENCES "insumos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compras_insumo" ADD CONSTRAINT "compras_insumo_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "proveedores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

