-- Regla del negocio: la comisión de DiDi es plana sobre el total, 43 % si el cliente paga con
-- tarjeta / en la app y 35 % si paga en efectivo. Sustituye a comisión + IVA + retenciones.
ALTER TABLE "config_comision_plataforma"
  ADD COLUMN "comisionEnLineaPct" DECIMAL(6,2) NOT NULL DEFAULT 43,
  ADD COLUMN "comisionEfectivoPct" DECIMAL(6,2) NOT NULL DEFAULT 35;

ALTER TABLE "config_comision_plataforma"
  DROP COLUMN "comisionPct",
  DROP COLUMN "ivaComisionPct",
  DROP COLUMN "retencionPct",
  DROP COLUMN "ivaVentaPct";
