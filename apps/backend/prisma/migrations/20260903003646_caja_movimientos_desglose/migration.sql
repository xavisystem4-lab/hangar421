-- CreateEnum
CREATE TYPE "TipoMovimientoCaja" AS ENUM ('INGRESO', 'EGRESO');

-- AlterTable
ALTER TABLE "turnos" ADD COLUMN     "desgloseEfectivo" JSONB;

-- CreateTable
CREATE TABLE "movimientos_caja" (
    "id" TEXT NOT NULL,
    "turnoId" TEXT NOT NULL,
    "tipo" "TipoMovimientoCaja" NOT NULL,
    "monto" DECIMAL(10,2) NOT NULL,
    "motivo" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimientos_caja_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "movimientos_caja_turnoId_idx" ON "movimientos_caja"("turnoId");

-- AddForeignKey
ALTER TABLE "movimientos_caja" ADD CONSTRAINT "movimientos_caja_turnoId_fkey" FOREIGN KEY ("turnoId") REFERENCES "turnos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_caja" ADD CONSTRAINT "movimientos_caja_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
