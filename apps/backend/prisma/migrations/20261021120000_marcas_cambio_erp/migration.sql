-- Marca de "hubo cambios en el ERP" por empresa: las tablets la consultan para avisar al instante.
CREATE TABLE "marcas_cambio_erp" (
    "empresaId" TEXT NOT NULL,
    "version" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "que" TEXT,
    "dispositivoId" TEXT,
    CONSTRAINT "marcas_cambio_erp_pkey" PRIMARY KEY ("empresaId")
);
