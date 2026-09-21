-- Enlace del POS de Windows con el ERP en la nube (fase F de trazabilidad). Solo se usan en el
-- backend embebido del POS; en la nube quedan vacías. Ver docs/vinculacion-pos-desktop.md.
-- CreateTable
CREATE TABLE "enlace_nube" (
    "id" TEXT NOT NULL DEFAULT 'principal',
    "urlErp" TEXT NOT NULL,
    "empresaIdNube" TEXT NOT NULL,
    "sucursalIdNube" TEXT NOT NULL,
    "sucursalNombreNube" TEXT NOT NULL,
    "sucursalIdLocal" TEXT NOT NULL,
    "dispositivoId" TEXT NOT NULL,
    "refreshCifrado" TEXT NOT NULL,
    "sincronizarDesde" TIMESTAMP(3) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "ultimoEnvio" TIMESTAMP(3),
    "ultimoError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enlace_nube_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mapeo_ids_nube" (
    "entidad" TEXT NOT NULL,
    "idLocal" TEXT NOT NULL,
    "idNube" TEXT,
    "nombreLocal" TEXT NOT NULL,
    "origen" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mapeo_ids_nube_pkey" PRIMARY KEY ("entidad","idLocal")
);

-- CreateTable
CREATE TABLE "envios_nube" (
    "entidad" TEXT NOT NULL,
    "entidadId" TEXT NOT NULL,
    "version" TIMESTAMP(3) NOT NULL,
    "estado" TEXT NOT NULL,
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "ultimoError" TEXT,
    "proximoIntento" TIMESTAMP(3),
    "enviadoAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "envios_nube_pkey" PRIMARY KEY ("entidad","entidadId")
);

-- CreateIndex
CREATE INDEX "envios_nube_estado_idx" ON "envios_nube"("estado");


