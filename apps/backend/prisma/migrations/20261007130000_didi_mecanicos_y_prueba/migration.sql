-- Grupo DIDI en las sucursales MECÁNICOS y PRUEBA, con el menú que publican en DiDi Food.
-- Migración de DATOS, no de esquema.
--
-- El grupo DIDI ya existe en el catálogo de la empresa (20261006120000_menu_benito_juarez_y_didi) y
-- hasta ahora solo estaba en venta en Benito Juárez. Esta migración lo pone en venta en estas dos
-- sucursales, buscadas por su id:
--   * 8437d80c-41a9-475a-a716-0338d26f6434  (Mecánicos)
--   * 524dd723-906c-4f53-86ab-0305d4fd23f3  (Prueba)
--
-- Precios: los que cobra DiDi hoy "con cupón" / promoción, uno por producto (lo que DiDi muestra
-- dos veces, en Promociones / Favoritos / Recomendados, se toma una sola vez).
--
--   * Un producto del grupo DIDI que ya existe con ese nombre se reutiliza (p. ej. Latte Frío,
--     Spooky Latte): solo cambia su precio y disponibilidad EN ESTAS DOS SUCURSALES. Benito Juárez
--     conserva los suyos.
--   * Los nombres nuevos (Chai Frío, Latte Chicago, galletas…) se crean dentro de DIDI y quedan en
--     STANDBY en las demás sucursales, Benito Juárez incluida.
--   * Lo que DIDI tiene y no está en este menú queda en standby en estas dos sucursales.
--
-- Idempotente (ids deterministas md5, ON CONFLICT). Si una de las sucursales no existe en esta base
-- (p. ej. el POS de Windows con datos demo), no se toca nada para ella. Un solo bloque DO: el
-- backend embebido del POS de Windows aplica sentencia por sentencia (auto-bootstrap.ts).

DO $$
DECLARE
  suc       RECORD;
  item      RECORD;
  v_cat_id  TEXT;
  v_prod_id TEXT;
  v_ids     TEXT[];
BEGIN
  FOR suc IN
    SELECT s.id, s."empresaId"
    FROM sucursales s
    WHERE s.id IN ('8437d80c-41a9-475a-a716-0338d26f6434', '524dd723-906c-4f53-86ab-0305d4fd23f3')
  LOOP
    v_ids := ARRAY[]::TEXT[];

    -- 1. Categoría DIDI de la empresa (la existente, activa primero) o una nueva.
    SELECT c.id INTO v_cat_id
    FROM categorias_producto c
    WHERE c."empresaId" = suc."empresaId"
      AND lower(translate(trim(c.nombre), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) = 'didi'
    ORDER BY c.activo DESC, c.id
    LIMIT 1;

    IF v_cat_id IS NULL THEN
      v_cat_id := md5('h421-cat-' || suc."empresaId" || '-didi')::uuid::text;
      INSERT INTO categorias_producto (id, "empresaId", nombre, orden, activo)
      VALUES (v_cat_id, suc."empresaId", 'DIDI', 12, true)
      ON CONFLICT (id) DO NOTHING;
    END IF;
    UPDATE categorias_producto SET activo = true WHERE id = v_cat_id AND activo = false;

    FOR item IN
      SELECT * FROM (VALUES
      ('Bebidas frías', 'Latte Frío', 'Espresso doble con leche, vaso de 16 oz', 66.00, 1, 'BARRA'),
      ('Bebidas frías', 'Matcha Iced Latte', 'Leche con matcha ceremonial', 75.00, 2, 'BARRA'),
      ('Bebidas frías', 'Americano Frío', 'Espresso doble y agua, vaso de 16 oz', 67.20, 3, 'BARRA'),
      ('Bebidas frías', 'Chai Frío', 'Chai de especias con leche, vaso de 16 oz', 92.00, 4, 'BARRA'),
      ('Bebidas frías', 'Dirty Chai Frío', 'Chai de especias con doble shot de espresso y leche', 108.00, 5, 'BARRA'),
      ('Bebidas frías', 'Latte Maple y Sal', 'Espresso doble con leche, jarabe de maple y un toque de sal', 112.00, 6, 'BARRA'),
      ('Bebidas frías', 'Latte Amanecer', 'Doble shot de espresso con miel de agave y canela', 128.00, 7, 'BARRA'),
      ('Bebidas frías', 'Espresso Tónico', 'Doble espresso con agua tónica', 100.00, 8, 'BARRA'),
      ('Bebidas frías', 'Cold Brew', 'Café black honey infusionado 18 horas, con hielo, 16 oz', 84.00, 9, 'BARRA'),
      ('Bebidas frías', 'To Go Latte', 'Latte enlatado de 500 ml', 128.00, 10, 'BARRA'),
      ('Bebidas frías', 'Bomba Latte', NULL, 56.00, 11, 'BARRA'),
      ('Bebidas frías', 'Latte Chicago', 'Espresso doble con leche sabor palomitas Chicago, 16 oz', 108.00, 12, 'BARRA'),
      ('Bebidas calientes', 'Americano Caliente', 'Doble shot de espresso y agua caliente, 12 oz', 56.00, 13, 'BARRA'),
      ('Bebidas calientes', 'Latte Caliente', 'Espresso doble con leche cremada, 12 oz', 78.40, 14, 'BARRA'),
      ('Bebidas calientes', 'Chai Caliente', 'Chai de especias con leche cremada, 12 oz', 95.20, 15, 'BARRA'),
      ('Bebidas calientes', 'Dirty Chai Caliente', 'Chai de especias con doble shot de espresso y leche cremada', 112.00, 16, 'BARRA'),
      ('Bebidas calientes', 'Flat White', NULL, 80.00, 17, 'BARRA'),
      ('Bebidas calientes', 'Capuccino', NULL, 91.20, 18, 'BARRA'),
      ('Refresher', 'Dirty Piña Colada', 'Espresso doble con jugo de piña y agua de coco, 16 oz', 123.20, 19, 'BARRA'),
      ('Refresher', 'Nébula Tonic', 'Agua tónica, blue matcha y jugo de limón natural', 117.60, 20, 'BARRA'),
      ('Refresher', 'Coco Matcha Cloud', NULL, 104.00, 21, 'BARRA'),
      ('Postres', 'Galleta Macadamia', 'Nuez de macadamia con chispas de chocolate blanco y un toque de sal', 72.00, 22, 'POSTRES'),
      ('Postres', 'Banana Muffin', 'Muffin de plátano con chispas de chocolate. Gluten free', 76.00, 23, 'POSTRES'),
      ('Postres', 'Strudel de Manzana', NULL, 41.60, 24, 'POSTRES'),
      ('Postres', 'Birthday Cake Cookie', NULL, 84.00, 25, 'POSTRES'),
      ('Postres', 'Carrot Cake Cookie', NULL, 84.00, 26, 'POSTRES'),
      ('Postres', 'Cinnamon Cake Cookie', NULL, 84.00, 27, 'POSTRES'),
      ('Postres', 'Fudge Chocolate Cookie', NULL, 84.00, 28, 'POSTRES'),
      ('Postres', 'Red Velvet Cookie', NULL, 84.00, 29, 'POSTRES'),
      ('Postres', 'Fudgy Brownie', 'Brownie cremoso de chocolate con cacao', 56.00, 30, 'POSTRES'),
      ('Temporada', 'Pumpkin Spice Latte', NULL, 91.80, 31, 'BARRA'),
      ('Temporada', 'Pumpkin Spice Matcha', NULL, 102.00, 32, 'BARRA'),
      ('Temporada', 'Spooky Latte', NULL, 108.00, 33, 'BARRA'),
      ('Temporada', 'S''mores Latte', NULL, 108.00, 34, 'BARRA'),
      ('Temporada', 'Matcha Cold Foam Pumpkin Spice Sugar Free', NULL, 120.00, 35, 'BARRA'),
      ('La Oficina', 'Blue Lover (2 Lattes Maple y Sal fríos)', NULL, 112.00, 36, 'BARRA')
      ) AS m(subcategoria, nombre, descripcion, precio, orden, estacion)
      ORDER BY orden
    LOOP
      -- 2. Producto DIDI con ese nombre (activo primero) o uno nuevo.
      SELECT p.id INTO v_prod_id
      FROM productos p
      WHERE p."empresaId" = suc."empresaId" AND p."categoriaId" = v_cat_id
        AND lower(translate(trim(p.nombre), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'))
          = lower(translate(trim(item.nombre), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'))
      ORDER BY p.activo DESC, p.id
      LIMIT 1;

      IF v_prod_id IS NULL THEN
        v_prod_id := md5('h421-prod-' || suc."empresaId" || '-didi-' || lower(item.nombre))::uuid::text;
        INSERT INTO productos (id, "empresaId", "categoriaId", nombre, descripcion, subcategoria, "precioBase",
                               orden, activo, "requierePersonalizacion", "estacionPreparacion", "createdAt", "updatedAt")
        VALUES (v_prod_id, suc."empresaId", v_cat_id, item.nombre, item.descripcion, item.subcategoria, item.precio,
                100 + item.orden, true, false, item.estacion::"EstacionPreparacion", now(), now())
        ON CONFLICT (id) DO NOTHING;

        -- Nuevo: en standby en todas las sucursales de la empresa (el paso 3 lo enciende aquí).
        INSERT INTO productos_sucursal (id, "productoId", "sucursalId", precio, disponible, "stockControlado")
        SELECT md5('h421-ps-' || v_prod_id || '-' || s.id)::uuid::text, v_prod_id, s.id, item.precio, false, false
        FROM sucursales s
        WHERE s."empresaId" = suc."empresaId"
        ON CONFLICT ("productoId", "sucursalId") DO NOTHING;
      ELSE
        UPDATE productos SET activo = true, "updatedAt" = now() WHERE id = v_prod_id AND activo = false;
      END IF;

      -- 3. En venta en esta sucursal con el precio de DiDi.
      INSERT INTO productos_sucursal (id, "productoId", "sucursalId", precio, disponible, "stockControlado")
      VALUES (md5('h421-ps-' || v_prod_id || '-' || suc.id)::uuid::text, v_prod_id, suc.id, item.precio, true, false)
      ON CONFLICT ("productoId", "sucursalId") DO UPDATE SET precio = EXCLUDED.precio, disponible = true;

      v_ids := array_append(v_ids, v_prod_id);
    END LOOP;

    -- 4. Lo demás del grupo DIDI (menú de Benito Juárez): standby en esta sucursal.
    UPDATE productos_sucursal ps
    SET disponible = false
    FROM productos p
    WHERE ps."productoId" = p.id
      AND ps."sucursalId" = suc.id
      AND p."categoriaId" = v_cat_id
      AND NOT (p.id = ANY (v_ids));
  END LOOP;
END $$;
