-- Delivery: estado CANCELADA (la plataforma canceló la orden) y rastro de la confirmación de
-- aceptar/rechazar contra la plataforma (ver PlataformasService.aceptarPedido).
ALTER TYPE "EstadoSincronizacionOrdenPlataforma" ADD VALUE IF NOT EXISTS 'CANCELADA';

ALTER TABLE "plataforma_orden_syncs" ADD COLUMN IF NOT EXISTS "estadoExterno" TEXT;
ALTER TABLE "plataforma_orden_syncs" ADD COLUMN IF NOT EXISTS "confirmacion" TEXT;
ALTER TABLE "plataforma_orden_syncs" ADD COLUMN IF NOT EXISTS "aceptadaEn" TIMESTAMP(3);
ALTER TABLE "plataforma_orden_syncs" ADD COLUMN IF NOT EXISTS "ultimoIntentoError" TEXT;
ALTER TABLE "plataforma_orden_syncs" ADD COLUMN IF NOT EXISTS "simulado" BOOLEAN NOT NULL DEFAULT false;
-- Reclamo atómico al aceptar (dos terminales a la vez): id del intento y cuándo. Caduca solo.
ALTER TABLE "plataforma_orden_syncs" ADD COLUMN IF NOT EXISTS "reclamadoPor" TEXT;
ALTER TABLE "plataforma_orden_syncs" ADD COLUMN IF NOT EXISTS "reclamadoEn" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "plataforma_webhook_events_procesadoOk_idx" ON "plataforma_webhook_events"("plataformaConfigId", "procesadoOk");
