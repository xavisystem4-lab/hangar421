-- CreateTable
CREATE TABLE "horarios_usuario" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "diaSemana" INTEGER NOT NULL,
    "horaInicio" TEXT NOT NULL,
    "horaFin" TEXT NOT NULL,
    "notas" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "horarios_usuario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "horarios_usuario_usuarioId_idx" ON "horarios_usuario"("usuarioId");

-- CreateIndex
CREATE INDEX "horarios_usuario_sucursalId_idx" ON "horarios_usuario"("sucursalId");

-- AddForeignKey
ALTER TABLE "horarios_usuario" ADD CONSTRAINT "horarios_usuario_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "horarios_usuario" ADD CONSTRAINT "horarios_usuario_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "sucursales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
