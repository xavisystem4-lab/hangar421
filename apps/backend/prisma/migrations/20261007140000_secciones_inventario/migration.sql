-- Secciones físicas de cada sucursal para el conteo de inventario (Exhibidor, Refrigerador 1…)
-- y en cuál se guarda cada insumo. Ver SeccionInventario / InsumoSeccion en schema.prisma.
-- CreateTable
CREATE TABLE "secciones_inventario" (
    "id" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "secciones_inventario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insumos_seccion" (
    "insumoId" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "seccionId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "insumos_seccion_pkey" PRIMARY KEY ("insumoId","sucursalId")
);

-- CreateIndex
CREATE INDEX "secciones_inventario_sucursalId_idx" ON "secciones_inventario"("sucursalId");

-- CreateIndex
CREATE INDEX "insumos_seccion_sucursalId_idx" ON "insumos_seccion"("sucursalId");

-- AddForeignKey
ALTER TABLE "secciones_inventario" ADD CONSTRAINT "secciones_inventario_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "sucursales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insumos_seccion" ADD CONSTRAINT "insumos_seccion_insumoId_fkey" FOREIGN KEY ("insumoId") REFERENCES "insumos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insumos_seccion" ADD CONSTRAINT "insumos_seccion_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "sucursales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insumos_seccion" ADD CONSTRAINT "insumos_seccion_seccionId_fkey" FOREIGN KEY ("seccionId") REFERENCES "secciones_inventario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
