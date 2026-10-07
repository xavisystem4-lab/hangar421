-- Crédito de empleado: método de pago + monedero electrónico por empleada.
-- El saldo no se guarda: sale de `limite − movimientos desde el último reinicio` (ver monedero.ts).
ALTER TYPE "MetodoPago" ADD VALUE 'MONEDERO_EMPLEADO';

CREATE TABLE "monederos_empleado" (
    "usuarioId" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "sucursalId" TEXT,
    "limite" DECIMAL(10,2) NOT NULL DEFAULT 500,
    "diaReinicio" INTEGER NOT NULL,
    "horaReinicio" INTEGER NOT NULL,
    "minutoReinicio" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monederos_empleado_pkey" PRIMARY KEY ("usuarioId")
);

CREATE TABLE "movimientos_monedero" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "pedidoId" TEXT NOT NULL,
    "monto" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "registradoAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimientos_monedero_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "monederos_empleado_empresaId_idx" ON "monederos_empleado"("empresaId");
CREATE UNIQUE INDEX "movimientos_monedero_pedidoId_key" ON "movimientos_monedero"("pedidoId");
CREATE INDEX "movimientos_monedero_usuarioId_createdAt_idx" ON "movimientos_monedero"("usuarioId", "createdAt");

ALTER TABLE "monederos_empleado" ADD CONSTRAINT "monederos_empleado_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "monederos_empleado" ADD CONSTRAINT "monederos_empleado_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "sucursales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "movimientos_monedero" ADD CONSTRAINT "movimientos_monedero_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "monederos_empleado"("usuarioId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Alta inicial de las empleadas con crédito. Se ubican por PRIMER NOMBRE (usuarios activos) y su
-- sucursal por nombre; si alguna no coincide queda sin alta y se da de alta con
-- PUT /monedero/:usuarioId. Reinicio (sin acumular): Diana, Andrea y Daniela los viernes 9 PM;
-- Dalia (cobra solo los sábados) los sábados 5 PM. Día: 0 = domingo … 6 = sábado.
INSERT INTO "monederos_empleado" ("usuarioId", "empresaId", "sucursalId", "limite", "diaReinicio", "horaReinicio", "minutoReinicio", "activo", "updatedAt")
SELECT u."id", u."empresaId",
       (SELECT s."id" FROM "sucursales" s WHERE s."empresaId" = u."empresaId" AND s."nombre" ILIKE v."sucursal" ORDER BY s."nombre" LIMIT 1),
       500, v."dia", v."hora", 0, true, CURRENT_TIMESTAMP
FROM "usuarios" u
JOIN (VALUES
  ('diana',   '%mec%',    5, 21),
  ('andrea',  '%mec%',    5, 21),
  ('daniela', '%benito%', 5, 21),
  ('dalia',   '%benito%', 6, 17)
) AS v("nombre", "sucursal", "dia", "hora")
  ON lower(split_part(btrim(u."nombre"), ' ', 1)) = v."nombre"
WHERE u."activo" = true AND u."eliminado" = false
ON CONFLICT ("usuarioId") DO NOTHING;
