-- Un solo monedero activo por empleada. El alta inicial (20261007160000) buscó por primer nombre y
-- cada empleada tiene un usuario por sucursal, así que "Diana" o "Andrea" quedaron con dos
-- monederos. El crédito es uno solo y se usa en cualquier sucursal.
--
-- Entre los monederos activos con el mismo primer nombre (misma empresa) se queda UNO:
--   1) el de su sucursal (monedero.sucursalId donde ese usuario está asignado),
--   2) si ninguno cumple, el usuario más antiguo (y por id, para que el desempate sea estable).
-- Los demás se APAGAN (no se borran: conservan su historial). Sus consumos pasan al que se queda,
-- para que el saldo no se "regale" de nuevo.
WITH base AS (
  SELECT m."usuarioId", m."empresaId",
         lower(split_part(btrim(u."nombre"), ' ', 1)) AS clave,
         EXISTS (SELECT 1 FROM "usuarios_sucursales" us
                 WHERE us."usuarioId" = m."usuarioId" AND us."sucursalId" = m."sucursalId") AS en_su_sucursal,
         u."createdAt" AS usuario_desde
  FROM "monederos_empleado" m
  JOIN "usuarios" u ON u."id" = m."usuarioId"
  WHERE m."activo" = true
),
ordenados AS (
  SELECT b.*,
         row_number() OVER (PARTITION BY b."empresaId", b.clave ORDER BY b.en_su_sucursal DESC, b.usuario_desde ASC, b."usuarioId" ASC) AS puesto,
         first_value(b."usuarioId") OVER (PARTITION BY b."empresaId", b.clave ORDER BY b.en_su_sucursal DESC, b.usuario_desde ASC, b."usuarioId" ASC) AS se_queda
  FROM base b
),
sobrantes AS (
  SELECT "usuarioId", se_queda FROM ordenados WHERE puesto > 1
),
mover AS (
  -- pedidoId es único, así que mover el consumo a otro usuario no puede chocar.
  UPDATE "movimientos_monedero" mm
     SET "usuarioId" = s.se_queda
    FROM sobrantes s
   WHERE mm."usuarioId" = s."usuarioId"
  RETURNING mm."id"
)
UPDATE "monederos_empleado" m
   SET "activo" = false, "updatedAt" = CURRENT_TIMESTAMP
  FROM sobrantes s
 WHERE m."usuarioId" = s."usuarioId";
