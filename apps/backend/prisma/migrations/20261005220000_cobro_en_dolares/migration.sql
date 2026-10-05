-- Cobro con billetes en dólares (cambio en pesos) y cuadre aparte en USD en el corte.
-- AlterEnum
ALTER TYPE "MetodoPago" ADD VALUE 'EFECTIVO_USD';

-- AlterTable
ALTER TABLE "pagos" ADD COLUMN "montoUsd" DECIMAL(10,2),
ADD COLUMN "tipoCambio" DECIMAL(10,4);

-- AlterTable
ALTER TABLE "turnos" ADD COLUMN "tipoCambioUsd" DECIMAL(10,4),
ADD COLUMN "montoFinalDeclaradoUsd" DECIMAL(10,2),
ADD COLUMN "montoFinalSistemaUsd" DECIMAL(10,2),
ADD COLUMN "diferenciaUsd" DECIMAL(10,2);
