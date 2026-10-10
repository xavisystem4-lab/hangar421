-- Correo saliente del ERP configurado por empresa desde Admin → Correo (contraseña cifrada).
CREATE TABLE "configuracion_correo" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "proveedor" TEXT NOT NULL DEFAULT 'gmail',
    "host" TEXT NOT NULL,
    "puerto" INTEGER NOT NULL DEFAULT 587,
    "seguridad" TEXT NOT NULL DEFAULT 'STARTTLS',
    "usuario" TEXT NOT NULL,
    "passwordCifrado" TEXT,
    "remitenteNombre" TEXT,
    "remitenteCorreo" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "ultimaPruebaEn" TIMESTAMP(3),
    "ultimaPruebaOk" BOOLEAN,
    "ultimoError" TEXT,
    "actualizadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configuracion_correo_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "configuracion_correo_empresaId_key" ON "configuracion_correo"("empresaId");

ALTER TABLE "configuracion_correo" ADD CONSTRAINT "configuracion_correo_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
