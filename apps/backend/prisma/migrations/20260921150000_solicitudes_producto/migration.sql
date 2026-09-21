-- Solicitudes de alta de productos que no existen en el catálogo (fase D de trazabilidad).
-- La venta se detiene en el punto de venta y queda esta solicitud para que un administrador
-- registre el producto a mano: nunca se crea solo. Ver modelo SolicitudProducto.
-- CreateEnum
CREATE TYPE "EstadoSolicitudProducto" AS ENUM ('PENDIENTE', 'ATENDIDA', 'DESCARTADA');

-- CreateTable
CREATE TABLE "solicitudes_producto" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "usuarioId" TEXT,
    "dispositivoId" TEXT,
    "texto" TEXT NOT NULL,
    "estado" "EstadoSolicitudProducto" NOT NULL DEFAULT 'PENDIENTE',
    "solicitadaEn" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resueltaEn" TIMESTAMP(3),
    "resueltaPorId" TEXT,
    "productoId" TEXT,
    "notaResolucion" TEXT,

    CONSTRAINT "solicitudes_producto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "solicitudes_producto_empresaId_estado_idx" ON "solicitudes_producto"("empresaId", "estado");

-- CreateIndex
CREATE INDEX "solicitudes_producto_sucursalId_idx" ON "solicitudes_producto"("sucursalId");

-- AddForeignKey
ALTER TABLE "solicitudes_producto" ADD CONSTRAINT "solicitudes_producto_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes_producto" ADD CONSTRAINT "solicitudes_producto_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "sucursales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes_producto" ADD CONSTRAINT "solicitudes_producto_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes_producto" ADD CONSTRAINT "solicitudes_producto_dispositivoId_fkey" FOREIGN KEY ("dispositivoId") REFERENCES "dispositivos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes_producto" ADD CONSTRAINT "solicitudes_producto_resueltaPorId_fkey" FOREIGN KEY ("resueltaPorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes_producto" ADD CONSTRAINT "solicitudes_producto_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "productos"("id") ON DELETE SET NULL ON UPDATE CASCADE;


