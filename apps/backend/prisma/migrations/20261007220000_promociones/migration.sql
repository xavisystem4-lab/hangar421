-- Promociones de catálogo: precio especial (directo o %) en productos elegidos, con días, horario y fechas.
CREATE TABLE "promociones" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "sucursalId" TEXT,
    "nombre" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "dias" INTEGER[],
    "horaInicio" TEXT,
    "horaFin" TEXT,
    "fechaInicio" TEXT,
    "fechaFin" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadaPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promociones_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "promocion_productos" (
    "promocionId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,

    CONSTRAINT "promocion_productos_pkey" PRIMARY KEY ("promocionId","productoId")
);

CREATE INDEX "promociones_empresaId_idx" ON "promociones"("empresaId");
CREATE INDEX "promocion_productos_productoId_idx" ON "promocion_productos"("productoId");

ALTER TABLE "promociones" ADD CONSTRAINT "promociones_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "promocion_productos" ADD CONSTRAINT "promocion_productos_promocionId_fkey" FOREIGN KEY ("promocionId") REFERENCES "promociones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "promocion_productos" ADD CONSTRAINT "promocion_productos_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Promoción con la que se vendió cada línea (sin FK: la promoción puede editarse o apagarse después).
ALTER TABLE "pedido_items" ADD COLUMN "promocionId" TEXT;
