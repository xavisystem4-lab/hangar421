-- CreateEnum
CREATE TYPE "EstacionPreparacion" AS ENUM ('BARRA', 'COCINA', 'POSTRES');

-- AlterTable
ALTER TABLE "productos" ADD COLUMN     "estacionPreparacion" "EstacionPreparacion",
ADD COLUMN     "impuestoOverride" DECIMAL(5,4),
ADD COLUMN     "orden" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "requierePersonalizacion" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "subcategoria" TEXT;
