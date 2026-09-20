-- Vincula cada venta con su turno de caja.
--
-- Antes el corte deducía qué ventas eran suyas comparando `pedidos.cajeroId` con
-- `turnos.usuarioId` más la hora de apertura. Eso ya fallaba con dos cajeros cobrando en el
-- mismo turno (solo contaban las de uno), y se descuadraba por completo si el turno cambiaba de
-- responsable.
--
-- Nullable a propósito: las ventas ya registradas no tienen turno y no se puede inventar.
-- `CajaService.calcularMontoEsperado` mantiene el cálculo antiguo para esos turnos heredados.
ALTER TABLE "pedidos" ADD COLUMN "turnoId" TEXT;

ALTER TABLE "pedidos"
  ADD CONSTRAINT "pedidos_turnoId_fkey"
  FOREIGN KEY ("turnoId") REFERENCES "turnos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "pedidos_turnoId_idx" ON "pedidos"("turnoId");
