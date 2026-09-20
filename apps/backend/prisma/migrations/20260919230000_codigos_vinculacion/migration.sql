-- CreateTable
CREATE TABLE "codigos_vinculacion" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "creadoPorId" TEXT NOT NULL,
    "rol" "RolUsuario" NOT NULL DEFAULT 'CAJERO',
    "expiraAt" TIMESTAMP(3) NOT NULL,
    "usadoAt" TIMESTAMP(3),
    "dispositivoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "codigos_vinculacion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "codigos_vinculacion_codigo_key" ON "codigos_vinculacion"("codigo");

-- CreateIndex
CREATE INDEX "codigos_vinculacion_sucursalId_idx" ON "codigos_vinculacion"("sucursalId");

-- CreateIndex
CREATE INDEX "codigos_vinculacion_expiraAt_idx" ON "codigos_vinculacion"("expiraAt");

-- AddForeignKey
ALTER TABLE "codigos_vinculacion" ADD CONSTRAINT "codigos_vinculacion_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "codigos_vinculacion" ADD CONSTRAINT "codigos_vinculacion_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "sucursales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "codigos_vinculacion" ADD CONSTRAINT "codigos_vinculacion_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
