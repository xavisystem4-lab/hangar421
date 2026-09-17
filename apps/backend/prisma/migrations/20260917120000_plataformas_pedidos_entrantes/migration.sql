-- AlterEnum
ALTER TYPE "CanalOrigen" ADD VALUE 'PLATAFORMA_DELIVERY';

-- AlterTable
ALTER TABLE "plataforma_orden_syncs" ADD COLUMN "clienteNombre" TEXT,
ADD COLUMN "totalExterno" DECIMAL(10,2);
