-- Comisión pactada con DiDi (y otras plataformas) para el reporte de ganancia real del ERP.
CREATE TABLE "config_comision_plataforma" (
    "empresaId" TEXT NOT NULL,
    "plataforma" TEXT NOT NULL,
    "comisionPct" DECIMAL(6,2) NOT NULL DEFAULT 30,
    "ivaComisionPct" DECIMAL(6,2) NOT NULL DEFAULT 16,
    "retencionPct" DECIMAL(6,2) NOT NULL DEFAULT 10.5,
    "ivaVentaPct" DECIMAL(6,2) NOT NULL DEFAULT 16,
    "subsidios" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "config_comision_plataforma_pkey" PRIMARY KEY ("empresaId","plataforma")
);
