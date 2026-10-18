-- Cada aviso de "operación rechazada" pertenece a la sucursal de la operación, no a la del
-- dispositivo (que cambia cuando la tablet se mueve de sucursal).
ALTER TABLE "sync_queue_items" ADD COLUMN "sucursalId" TEXT;
CREATE INDEX "sync_queue_items_sucursalId_estado_idx" ON "sync_queue_items"("sucursalId", "estado");

-- Rellenar lo que ya existe: pedidos y pagos cuelgan del pedido (su entidadId es el id del pedido).
UPDATE "sync_queue_items" q SET "sucursalId" = p."sucursalId"
FROM "pedidos" p
WHERE q."sucursalId" IS NULL AND q."entidad" IN ('PEDIDO', 'PAGO') AND p."id" = q."entidadId";

-- Lo demás, con la sucursal del dispositivo (mejor dato disponible).
UPDATE "sync_queue_items" q SET "sucursalId" = d."sucursalId"
FROM "dispositivos" d
WHERE q."sucursalId" IS NULL AND d."id" = q."dispositivoId";

-- Avisos falsos: "Unique constraint failed on the fields: (`id`)" de pedidos que SÍ quedaron
-- registrados (dos envíos simultáneos del mismo pedido; uno entró y el otro chocó). La venta
-- existe, así que el aviso se da por resuelto.
UPDATE "sync_queue_items" q SET "estado" = 'SYNCED', "syncedAt" = NOW(), "ultimoError" = NULL
FROM "pedidos" p
WHERE q."estado" = 'ERROR' AND q."entidad" = 'PEDIDO' AND q."operacion" = 'CREATE' AND p."id" = q."entidadId";
