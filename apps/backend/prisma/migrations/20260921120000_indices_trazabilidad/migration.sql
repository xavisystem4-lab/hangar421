-- Índices para los filtros de trazabilidad del ERP (fase B): ventas por rango de fechas de la
-- empresa, por usuario (mesero o cajero) y por dispositivo, y turnos abiertos por sucursal (la
-- alerta de turnos pendientes de un día anterior se consulta en cada carga).
CREATE INDEX "pedidos_empresaId_createdAt_idx" ON "pedidos"("empresaId", "createdAt");
CREATE INDEX "pedidos_cajeroId_idx" ON "pedidos"("cajeroId");
CREATE INDEX "pedidos_meseroId_idx" ON "pedidos"("meseroId");
CREATE INDEX "pedidos_dispositivoId_idx" ON "pedidos"("dispositivoId");
CREATE INDEX "turnos_sucursalId_estado_idx" ON "turnos"("sucursalId", "estado");
