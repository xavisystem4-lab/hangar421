-- Preparaciones de la casa (cold foam, etc.): un insumo que se hace con otros insumos.
ALTER TABLE "insumos" ADD COLUMN "esPreparacion" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "receta_preparaciones" (
    "id" TEXT NOT NULL,
    "preparacionId" TEXT NOT NULL,
    "insumoId" TEXT NOT NULL,
    "cantidad" DECIMAL(12,4) NOT NULL,

    CONSTRAINT "receta_preparaciones_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "receta_preparaciones_preparacionId_insumoId_key" ON "receta_preparaciones"("preparacionId", "insumoId");
CREATE INDEX "receta_preparaciones_insumoId_idx" ON "receta_preparaciones"("insumoId");

ALTER TABLE "receta_preparaciones" ADD CONSTRAINT "receta_preparaciones_preparacionId_fkey" FOREIGN KEY ("preparacionId") REFERENCES "insumos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "receta_preparaciones" ADD CONSTRAINT "receta_preparaciones_insumoId_fkey" FOREIGN KEY ("insumoId") REFERENCES "insumos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
