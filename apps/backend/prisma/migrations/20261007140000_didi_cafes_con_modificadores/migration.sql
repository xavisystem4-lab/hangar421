-- Grupo DIDI: los cafés y bebidas preparadas pasan a ser productos COMPUESTOS — al venderlos el POS
-- pregunta lo mismo que en las bebidas del mostrador (Tamaño, Tipo de leche, Extras, Jarabe,
-- Cold Foam). Los cafés sin leche (Americano, Espresso, Espresso Tónico, Orange Tonic y Americano
-- Frío) preguntan Tamaño, Extras y Jarabe. Órbita, Matcha Flight y los postres no cambian.
--
-- Los modificadores se toman de la bebida modelo del mostrador ("Bebidas calientes" / "Latte");
-- si esa empresa no la tiene, se buscan por nombre. Aplica a toda empresa que tenga el grupo DIDI
-- (los modificadores son del producto, no de la sucursal). Migración de DATOS, idempotente: solo
-- AGREGA vínculos (no quita los que alguien haya puesto) y enciende requierePersonalizacion.

DO $$
DECLARE
  emp   RECORD;
  item  RECORD;
  v_modelo_id TEXT;
  v_mods      TEXT[];
  v_sin_leche TEXT[];
  v_elegidos  TEXT[];
  v_prod_id   TEXT;
  v_mod_id    TEXT;
  v_orden     INT;
  v_total     INT := 0;
BEGIN
  FOR emp IN
    SELECT DISTINCT c."empresaId" AS id
    FROM categorias_producto c
    WHERE lower(translate(trim(c.nombre), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) = 'didi'
  LOOP
    -- 1. Modificadores de la bebida modelo del mostrador, en su orden.
    SELECT p.id INTO v_modelo_id
    FROM productos p JOIN categorias_producto c ON c.id = p."categoriaId"
    WHERE p."empresaId" = emp.id
      AND lower(translate(trim(c.nombre), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) = 'bebidas calientes'
      AND lower(translate(trim(p.nombre), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) = 'latte'
    ORDER BY (SELECT count(*) FROM producto_modificadores pm WHERE pm."productoId" = p.id) DESC, p.activo DESC, p.id
    LIMIT 1;

    v_mods := ARRAY(
      SELECT pm."modificadorId" FROM producto_modificadores pm
      WHERE pm."productoId" = v_modelo_id ORDER BY pm.orden, pm."modificadorId"
    );

    -- 2. Sin modelo: por nombre dentro de la empresa (uno por nombre).
    IF coalesce(array_length(v_mods, 1), 0) = 0 THEN
      v_mods := ARRAY(
        SELECT id FROM (
          SELECT DISTINCT ON (lower(translate(trim(m.nombre), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'))) m.id,
                 lower(translate(trim(m.nombre), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) AS clave
          FROM modificadores m
          WHERE m."empresaId" = emp.id
            AND lower(translate(trim(m.nombre), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) IN ('tamano', 'tipo de leche', 'extras', 'jarabe', 'cold foam')
          ORDER BY lower(translate(trim(m.nombre), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')), m.id
        ) t
        ORDER BY array_position(ARRAY['tamano', 'tipo de leche', 'extras', 'jarabe', 'cold foam'], t.clave)
      );
    END IF;

    IF coalesce(array_length(v_mods, 1), 0) = 0 THEN
      RAISE NOTICE 'Empresa %: no hay modificadores de bebida; el grupo DIDI queda sin cambios', emp.id;
      CONTINUE;
    END IF;

    -- Cafés sin leche: todo menos "Tipo de leche" y "Cold Foam".
    v_sin_leche := ARRAY(
      SELECT m.id FROM modificadores m
      WHERE m.id = ANY (v_mods)
        AND lower(translate(trim(m.nombre), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) NOT LIKE '%leche%'
        AND lower(translate(trim(m.nombre), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) NOT LIKE '%cold foam%'
      ORDER BY array_position(v_mods, m.id)
    );

    -- 3. Productos del grupo DIDI (por nombre normalizado) y qué juego de modificadores llevan.
    FOR item IN
      SELECT * FROM (VALUES
        -- con leche: las cinco preguntas del mostrador
        ('Noir PB', true), ('DTO', true),
        ('Latte', true), ('Flat White', true), ('Cortado', true), ('Capuccino', true),
        ('Chai Sugar Free', true), ('Dirty Chai Sugar Free', true), ('Chai Pistache', true),
        ('Matcha Latte', true), ('Latte Frío', true), ('Latte Maple y Sal', true), ('Latte Amanecer', true),
        ('Chai Sugar Free Frío', true), ('Dirty Chai Sugar Free Frío', true), ('Chai Pistache Frío', true),
        ('Matcha Iced Latte', true), ('Coco Matcha Cloud', true),
        ('Spooky Latte', true), ('S''mores Latte', true), ('Matcha Cold Foam Pumpkin Spice Sugar Free', true),
        ('Pumpkin Spice Latte', true), ('Pumpkin Spice Matcha', true),
        ('Blue Lover (2 Lattes Maple y Sal fríos)', true), ('The Perfect Match', true),
        -- sin leche: tamaño, extras y jarabe
        ('Americano', false), ('Espresso', false), ('Americano Frío', false),
        ('Espresso Tónico', false), ('Orange Tonic', false)
      ) AS m(nombre, con_leche)
    LOOP
      SELECT p.id INTO v_prod_id
      FROM productos p JOIN categorias_producto c ON c.id = p."categoriaId"
      WHERE p."empresaId" = emp.id
        AND lower(translate(trim(c.nombre), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) = 'didi'
        AND lower(translate(trim(p.nombre), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'))
          = lower(translate(trim(item.nombre), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'))
      ORDER BY p.activo DESC, p.id
      LIMIT 1;

      IF v_prod_id IS NULL THEN
        CONTINUE;  -- ese producto no existe en esta empresa: nada que hacer
      END IF;

      v_elegidos := CASE WHEN item.con_leche THEN v_mods ELSE v_sin_leche END;
      v_orden := 0;
      FOREACH v_mod_id IN ARRAY v_elegidos LOOP
        v_orden := v_orden + 1;
        INSERT INTO producto_modificadores (id, "productoId", "modificadorId", orden)
        VALUES (md5('h421-pm-' || v_prod_id || '-' || v_mod_id)::uuid::text, v_prod_id, v_mod_id, v_orden)
        ON CONFLICT ("productoId", "modificadorId") DO NOTHING;
      END LOOP;

      UPDATE productos
      SET "requierePersonalizacion" = true, "updatedAt" = now()
      WHERE id = v_prod_id AND ("requierePersonalizacion" = false OR coalesce(array_length(v_elegidos, 1), 0) > 0);

      v_total := v_total + 1;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'DIDI: % productos ahora preguntan modificadores', v_total;
END $$;
