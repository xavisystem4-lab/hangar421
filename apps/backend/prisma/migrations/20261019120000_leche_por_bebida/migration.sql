-- Gramos de leche por bebida (base, con cold foam, con shot extra, con ambos). Ver Producto en schema.prisma.
ALTER TABLE "productos" ADD COLUMN "lecheBase" DECIMAL(10,2);
ALTER TABLE "productos" ADD COLUMN "lecheConColdFoam" DECIMAL(10,2);
ALTER TABLE "productos" ADD COLUMN "lecheConShot" DECIMAL(10,2);
ALTER TABLE "productos" ADD COLUMN "lecheConAmbos" DECIMAL(10,2);
