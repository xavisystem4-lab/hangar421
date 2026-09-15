-- CreateEnum
CREATE TYPE "TurnoTrabajo" AS ENUM ('MATUTINO', 'VESPERTINO', 'NOCTURNO', 'MIXTO');

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "username" TEXT,
ADD COLUMN     "eliminado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "eliminadoAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "usuarios_sucursales" ADD COLUMN     "turno" "TurnoTrabajo",
ADD COLUMN     "perfilId" TEXT;

-- CreateTable
CREATE TABLE "perfiles" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "permisos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "perfiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_username_key" ON "usuarios"("username");

-- CreateIndex
CREATE INDEX "usuarios_sucursales_perfilId_idx" ON "usuarios_sucursales"("perfilId");

-- CreateIndex
CREATE INDEX "perfiles_empresaId_idx" ON "perfiles"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "perfiles_empresaId_nombre_key" ON "perfiles"("empresaId", "nombre");

-- AddForeignKey
ALTER TABLE "usuarios_sucursales" ADD CONSTRAINT "usuarios_sucursales_perfilId_fkey" FOREIGN KEY ("perfilId") REFERENCES "perfiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perfiles" ADD CONSTRAINT "perfiles_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
