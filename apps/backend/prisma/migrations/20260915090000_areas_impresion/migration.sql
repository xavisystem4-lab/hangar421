-- CreateTable
CREATE TABLE "areas_impresion" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "areas_impresion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "areas_impresion_empresaId_idx" ON "areas_impresion"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "areas_impresion_empresaId_nombre_key" ON "areas_impresion"("empresaId", "nombre");

-- AddForeignKey
ALTER TABLE "areas_impresion" ADD CONSTRAINT "areas_impresion_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
