-- Códigos de vinculación de empresa (fase E de trazabilidad): una terminal puede operar en varias
-- sucursales y cada persona elige la suya al entrar. Los códigos por sucursal siguen igual.
-- DropForeignKey
ALTER TABLE "codigos_vinculacion" DROP CONSTRAINT "codigos_vinculacion_sucursalId_fkey";

-- AlterTable
ALTER TABLE "codigos_vinculacion" ADD COLUMN     "sucursalesIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ALTER COLUMN "sucursalId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "codigos_vinculacion" ADD CONSTRAINT "codigos_vinculacion_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "sucursales"("id") ON DELETE SET NULL ON UPDATE CASCADE;


