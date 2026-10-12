-- Receta por OPCIÓN de modificador: qué insumo y cuánto consume cada opción elegida
-- (ej. "Leche de avena" → 240 ml de Leche-Avena), para no tener que listar todas las leches
-- en la receta fija del producto.
CREATE TABLE "receta_opciones" (
    "id" TEXT NOT NULL,
    "opcionModificadorId" TEXT NOT NULL,
    "insumoId" TEXT NOT NULL,
    "cantidad" DECIMAL(10,4) NOT NULL,

    CONSTRAINT "receta_opciones_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "receta_opciones_opcionModificadorId_insumoId_key" ON "receta_opciones"("opcionModificadorId", "insumoId");
CREATE INDEX "receta_opciones_insumoId_idx" ON "receta_opciones"("insumoId");

ALTER TABLE "receta_opciones" ADD CONSTRAINT "receta_opciones_opcionModificadorId_fkey" FOREIGN KEY ("opcionModificadorId") REFERENCES "opciones_modificador"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "receta_opciones" ADD CONSTRAINT "receta_opciones_insumoId_fkey" FOREIGN KEY ("insumoId") REFERENCES "insumos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
