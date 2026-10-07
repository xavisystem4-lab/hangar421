-- Precios propios de DiDi en los extras. Los productos del grupo DIDI comparten los grupos de
-- modificadores con el mostrador (Tipo de leche, Jarabe, Cold Foam), así que no se puede cambiar el
-- precio de esos grupos sin tocar el mostrador. Se crea una COPIA "<grupo> (DiDi)" por empresa con
-- los precios de DiDi y se cambia el vínculo SOLO de los productos de la categoría DIDI:
--   leche de almendra $28 · leche de avena $30 · jarabes $21 · cold foam $32
-- Las demás opciones (entera, deslactosada…) conservan su precio. Tamaño y Extras no cambian.
-- Los modificadores son de la empresa, no de la sucursal: aplica en TODAS las sucursales.
-- Migración de DATOS, idempotente (ids derivados del grupo/opción original; si ya hay copia no
-- se vuelve a crear ni se pisan precios editados después).

DO $$
DECLARE
  g RECORD;
  v_copia_id TEXT;
  v_clave    TEXT;
  v_enlaces  INT;
  v_grupos   INT := 0;
BEGIN
  FOR g IN
    SELECT DISTINCT m.id, m."empresaId", m.nombre, m.tipo, m.obligatorio,
           lower(translate(trim(m.nombre), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) AS clave
    FROM modificadores m
    JOIN producto_modificadores pm ON pm."modificadorId" = m.id
    JOIN productos p ON p.id = pm."productoId"
    JOIN categorias_producto c ON c.id = p."categoriaId"
    WHERE lower(translate(trim(c.nombre), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) = 'didi'
      AND (lower(translate(trim(m.nombre), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) LIKE '%leche%'
        OR lower(translate(trim(m.nombre), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) LIKE '%jarabe%'
        OR lower(translate(trim(m.nombre), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) LIKE '%cold foam%')
      AND m.nombre NOT LIKE '% (DiDi)'
  LOOP
    v_clave := g.clave;
    v_copia_id := md5('h421-moddidi-' || g.id)::uuid::text;

    INSERT INTO modificadores (id, "empresaId", nombre, tipo, obligatorio)
    VALUES (v_copia_id, g."empresaId", g.nombre || ' (DiDi)', g.tipo, g.obligatorio)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO opciones_modificador (id, "modificadorId", nombre, "precioExtra", orden, activo)
    SELECT md5('h421-opdidi-' || o.id)::uuid::text, v_copia_id, o.nombre,
           CASE
             WHEN v_clave LIKE '%leche%' AND lower(translate(o.nombre, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) LIKE '%almendra%' THEN 28
             WHEN v_clave LIKE '%leche%' AND lower(translate(o.nombre, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) LIKE '%avena%' THEN 30
             WHEN v_clave LIKE '%jarabe%' AND o."precioExtra" > 0 THEN 21
             WHEN v_clave LIKE '%cold foam%' AND o."precioExtra" > 0 THEN 32
             ELSE o."precioExtra"
           END,
           o.orden, true
    FROM opciones_modificador o
    WHERE o."modificadorId" = g.id AND o.activo = true
    ON CONFLICT (id) DO NOTHING;

    -- Solo los productos DIDI pasan a la copia; el mostrador sigue con el grupo original.
    UPDATE producto_modificadores pm
       SET "modificadorId" = v_copia_id
      FROM productos p
      JOIN categorias_producto c ON c.id = p."categoriaId"
     WHERE pm."productoId" = p.id
       AND pm."modificadorId" = g.id
       AND lower(translate(trim(c.nombre), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) = 'didi'
       AND NOT EXISTS (SELECT 1 FROM producto_modificadores x WHERE x."productoId" = pm."productoId" AND x."modificadorId" = v_copia_id);
    GET DIAGNOSTICS v_enlaces = ROW_COUNT;

    v_grupos := v_grupos + 1;
    RAISE NOTICE 'DIDI: "%" → copia con precios DiDi (% producto(s) enlazados)', g.nombre, v_enlaces;
  END LOOP;

  RAISE NOTICE 'DIDI: % grupo(s) con precios propios', v_grupos;
END $$;
