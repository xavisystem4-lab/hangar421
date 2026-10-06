-- Menú vigente de la sucursal BENITO JUÁREZ (PDF "MENU HANGAR 2 11x17") + grupo DIDI con el menú
-- que la sucursal publica en DiDi Food. Migración de DATOS, no de esquema.
--
-- Alcance — solo la sucursal cuyo nombre contiene "Benito" (sin distinguir acentos/mayúsculas):
--   * Lo que está en el PDF queda EN VENTA en Benito Juárez con el precio del PDF
--     (ProductoSucursal.precio / disponible = true).
--   * Todo lo demás del catálogo queda en STANDBY en Benito Juárez (ProductoSucursal.disponible =
--     false). NO se borra nada ni se toca Producto.activo: se puede volver a poner en venta desde
--     Admin → Catálogo del APK (o el CRM) cuando se quiera usar otra vez.
--   * La categoría DIDI y sus productos solo están en venta en Benito Juárez; en las demás
--     sucursales se dan de alta en standby. Igual para los productos NUEVOS del PDF.
--   * Las demás sucursales conservan su catálogo y precios tal cual.
--
-- Idempotente: categorías y productos se buscan por nombre normalizado antes de crearse, los ids
-- nuevos son deterministas (md5) y todo insert usa ON CONFLICT. Una empresa sin sucursal
-- "Benito…" (p. ej. la base demo del POS de Windows) no se toca.
--
-- Precios DIDI: el que hoy cobra DiDi (con la promoción vigente). El precio sin promoción queda
-- en la descripción del producto.
--
-- Todo va en UN solo bloque DO (sin tablas temporales): el backend embebido del POS de Windows
-- aplica cada sentencia por separado (auto-bootstrap.ts) y una tabla temporal no sobreviviría
-- entre conexiones del pool.

DO $$
DECLARE
  emp  RECORD;
  item RECORD;
  v_cat_id    TEXT;
  v_prod_id   TEXT;
  v_modelo_id TEXT;
  v_nuevo     BOOLEAN;
  v_menu_ids  TEXT[];
BEGIN
  FOR emp IN
    SELECT DISTINCT s."empresaId" AS id
    FROM sucursales s
    WHERE lower(translate(s.nombre, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) LIKE '%benito%'
  LOOP
    v_menu_ids := ARRAY[]::TEXT[];

    -- Nombres se comparan normalizados: minúsculas, sin acentos ni espacios sobrantes.
    FOR item IN
      SELECT * FROM (VALUES
        -- ── Menú del PDF ─────────────────────────────────────────────────────────────────────────────
        ('Bebidas calientes', 3, NULL, 'Americano',              NULL, 50, 1, 'BARRA', NULL, NULL),
        ('Bebidas calientes', 3, NULL, 'Latte',                  NULL, 70, 2, 'BARRA', 'Bebidas calientes', 'Latte'),
        ('Bebidas calientes', 3, NULL, 'Flat White',             NULL, 75, 3, 'BARRA', 'Bebidas calientes', 'Flat White'),
        ('Bebidas calientes', 3, NULL, 'Cortado',                NULL, 60, 4, 'BARRA', 'Bebidas calientes', 'Flat White'),
        ('Bebidas calientes', 3, NULL, 'Capuccino',              NULL, 85, 5, 'BARRA', 'Bebidas calientes', 'Capuccino'),
        ('Bebidas calientes', 3, NULL, 'Chai Sugar Free',        NULL, 85, 6, 'BARRA', 'Bebidas calientes', 'Chai'),
        ('Bebidas calientes', 3, NULL, 'Dirty Chai Sugar Free',  NULL, 100, 7, 'BARRA', 'Bebidas calientes', 'Dirty Chai'),
        ('Bebidas calientes', 3, NULL, 'Chai Pistache',          NULL, 100, 8, 'BARRA', 'Bebidas calientes', 'Chai'),
        ('Bebidas calientes', 3, NULL, 'Matcha Latte',           NULL, 80, 9, 'BARRA', 'Bebidas calientes', 'Matcha'),
        ('Bebidas calientes', 3, NULL, 'Espresso',               NULL, 45, 10, 'BARRA', NULL, NULL),

        ('Bebidas frías', 2, NULL, 'Americano/Aerocano',         NULL, 70, 1, 'BARRA', NULL, NULL),
        ('Bebidas frías', 2, NULL, 'Latte',                      NULL, 85, 2, 'BARRA', 'Bebidas frías', 'Latte'),
        ('Bebidas frías', 2, NULL, 'Latte Maple y Sal',          NULL, 100, 3, 'BARRA', 'Bebidas frías', 'Latte Maple y Sal'),
        ('Bebidas frías', 2, NULL, 'Latte Amanecer',             NULL, 125, 4, 'BARRA', 'Bebidas frías', 'Latte Amanecer'),
        ('Bebidas frías', 2, NULL, 'Chai Sugar Free',            NULL, 90, 5, 'BARRA', 'Bebidas frías', 'Chai'),
        ('Bebidas frías', 2, NULL, 'Dirty Chai Sugar Free',      NULL, 105, 6, 'BARRA', 'Bebidas frías', 'Dirty Chai'),
        ('Bebidas frías', 2, NULL, 'Chai Pistache',              NULL, 105, 7, 'BARRA', 'Bebidas frías', 'Chai'),
        ('Bebidas frías', 2, NULL, 'Matcha Iced Latte',          NULL, 95, 8, 'BARRA', 'Bebidas frías', 'Matcha Iced Latte'),
        ('Bebidas frías', 2, NULL, 'Espresso Tónico',            NULL, 90, 9, 'BARRA', 'Bebidas frías', 'Espresso Tonic'),
        ('Bebidas frías', 2, NULL, 'Orange Tonic',               NULL, 95, 10, 'BARRA', 'Bebidas frías', 'Espresso Tonic'),
        ('Bebidas frías', 2, NULL, 'Cold Brew',                  NULL, 80, 11, 'BARRA', 'Bebidas frías', 'Cold Brew Black Honey'),
        ('Bebidas frías', 2, NULL, 'Coco Matcha Cloud',          NULL, 100, 12, 'BARRA', 'Refresher', 'Coco Matcha Cloud'),

        ('Especialidades del Hangar', 8, NULL, 'Órbita',         'Creatina pink lemonade + matcha', 100, 1, 'BARRA', NULL, NULL),
        ('Especialidades del Hangar', 8, NULL, 'Noir PB',        'Espresso + crema de cacahuate + jarabe de cacao', 140, 2, 'BARRA', NULL, NULL),
        ('Especialidades del Hangar', 8, NULL, 'Matcha Flight',  'Agua de coco + matcha', 80, 3, 'BARRA', NULL, NULL),
        ('Especialidades del Hangar', 8, NULL, 'DTO',            'Espresso + dátil', 100, 4, 'BARRA', NULL, NULL),

        ('Alimentos', 9, NULL, 'Sándwich',                       'Pan masa madre & pechuga de pavo', 110, 1, 'COCINA', NULL, NULL),
        ('Alimentos', 9, NULL, 'Avocado Toast',                  'Pan masa madre, aguacate & sal', 70, 2, 'COCINA', NULL, NULL),

        ('Not Coffee', 10, 'Agua gasificada', 'Agua Gasificada Frambuesa Negra', NULL, 60, 1, 'BARRA', NULL, NULL),
        ('Not Coffee', 10, 'Agua gasificada', 'Agua Gasificada Mango Naranja',   NULL, 60, 2, 'BARRA', NULL, NULL),
        ('Not Coffee', 10, 'Agua gasificada', 'Agua Gasificada Fresa Kiwi',      NULL, 60, 3, 'BARRA', NULL, NULL),

        ('Postres', 4, NULL, 'Muffin de Plátano',                'Gluten free', 80, 1, 'POSTRES', NULL, NULL),
        ('Postres', 4, NULL, 'Brownie de Manzana Verde',         '9 gr de proteína', 60, 2, 'POSTRES', NULL, NULL),

        ('Extras', 7, NULL, 'Jarabe (hecho en casa)',            'Cacao, vainilla, plátano, agave, brown sugar, pistache', 15, 1, 'BARRA', NULL, NULL),
        ('Extras', 7, NULL, 'Cold Foam',                         NULL, 25, 2, 'BARRA', NULL, NULL),
        ('Extras', 7, NULL, 'Leche Vegetal',                     NULL, 25, 3, 'BARRA', NULL, NULL),
        ('Extras', 7, NULL, 'Shot de Espresso',                  NULL, 30, 4, 'BARRA', NULL, NULL),
        ('Extras', 7, NULL, 'Gramo de Matcha',                   NULL, 30, 5, 'BARRA', NULL, NULL),

        ('Pre-Work Out', 11, NULL, 'Creatina (10 gr)',           NULL, 30, 1, 'BARRA', NULL, NULL),
        ('Pre-Work Out', 11, NULL, 'Proteína (24 gr)',           NULL, 30, 2, 'BARRA', NULL, NULL),

        -- ── DIDI (menú publicado en DiDi Food; sin repetir lo que DiDi muestra dos veces en "Promociones")
        ('DIDI', 12, 'Especialidades del Hangar', 'Órbita',                    NULL, 180, 1, 'BARRA', NULL, NULL),
        ('DIDI', 12, 'Especialidades del Hangar', 'Noir PB',                   NULL, 255, 2, 'BARRA', NULL, NULL),
        ('DIDI', 12, 'Especialidades del Hangar', 'Matcha Flight',             'Promo DiDi -67% (antes $150)', 49, 3, 'BARRA', NULL, NULL),
        ('DIDI', 12, 'Especialidades del Hangar', 'DTO',                       NULL, 180, 4, 'BARRA', NULL, NULL),

        ('DIDI', 12, 'Bebidas calientes', 'Americano',                        'Promo DiDi -53% (antes $105)', 49, 11, 'BARRA', NULL, NULL),
        ('DIDI', 12, 'Bebidas calientes', 'Latte',                            'Promo DiDi -67% (antes $150)', 49, 12, 'BARRA', NULL, NULL),
        ('DIDI', 12, 'Bebidas calientes', 'Flat White',                       'Promo DiDi -67% (antes $150)', 49, 13, 'BARRA', NULL, NULL),
        ('DIDI', 12, 'Bebidas calientes', 'Cortado',                          NULL, 98, 14, 'BARRA', NULL, NULL),
        ('DIDI', 12, 'Bebidas calientes', 'Capuccino',                        NULL, 114, 15, 'BARRA', NULL, NULL),
        ('DIDI', 12, 'Bebidas calientes', 'Chai Sugar Free',                  NULL, 119, 16, 'BARRA', NULL, NULL),
        ('DIDI', 12, 'Bebidas calientes', 'Dirty Chai Sugar Free',            NULL, 140, 17, 'BARRA', NULL, NULL),
        ('DIDI', 12, 'Bebidas calientes', 'Chai Pistache',                    NULL, 145, 18, 'BARRA', NULL, NULL),
        ('DIDI', 12, 'Bebidas calientes', 'Espresso',                         NULL, 70, 19, 'BARRA', NULL, NULL),

        ('DIDI', 12, 'Bebidas frías', 'Matcha Latte',                         NULL, 125, 21, 'BARRA', NULL, NULL),
        ('DIDI', 12, 'Bebidas frías', 'Americano Frío',                       NULL, 84, 22, 'BARRA', NULL, NULL),
        ('DIDI', 12, 'Bebidas frías', 'Latte Frío',                           NULL, 110, 23, 'BARRA', NULL, NULL),
        ('DIDI', 12, 'Bebidas frías', 'Latte Maple y Sal',                    NULL, 140, 24, 'BARRA', NULL, NULL),
        ('DIDI', 12, 'Bebidas frías', 'Latte Amanecer',                       NULL, 160, 25, 'BARRA', NULL, NULL),
        ('DIDI', 12, 'Bebidas frías', 'Chai Sugar Free Frío',                 NULL, 115, 26, 'BARRA', NULL, NULL),
        ('DIDI', 12, 'Bebidas frías', 'Dirty Chai Sugar Free Frío',           NULL, 135, 27, 'BARRA', NULL, NULL),
        ('DIDI', 12, 'Bebidas frías', 'Chai Pistache Frío',                   NULL, 135, 28, 'BARRA', NULL, NULL),
        ('DIDI', 12, 'Bebidas frías', 'Matcha Iced Latte',                    NULL, 125, 29, 'BARRA', NULL, NULL),
        ('DIDI', 12, 'Bebidas frías', 'Espresso Tónico',                      NULL, 125, 30, 'BARRA', NULL, NULL),
        ('DIDI', 12, 'Bebidas frías', 'Orange Tonic',                         NULL, 135, 31, 'BARRA', NULL, NULL),
        ('DIDI', 12, 'Bebidas frías', 'Coco Matcha Cloud',                    NULL, 130, 32, 'BARRA', NULL, NULL),

        ('DIDI', 12, 'Postres', 'Brownie de Manzana Verde',                   'Promo DiDi -53% (antes $105)', 49, 41, 'POSTRES', NULL, NULL),
        ('DIDI', 12, 'Postres', 'Muffin de Plátano Gluten Free',              NULL, 99, 42, 'POSTRES', NULL, NULL),

        ('DIDI', 12, 'Temporada', 'Spooky Latte',                             NULL, 130, 51, 'BARRA', NULL, NULL),
        ('DIDI', 12, 'Temporada', 'S''mores Latte',                           NULL, 135, 52, 'BARRA', NULL, NULL),
        ('DIDI', 12, 'Temporada', 'Matcha Cold Foam Pumpkin Spice Sugar Free', NULL, 150, 53, 'BARRA', NULL, NULL),
        ('DIDI', 12, 'Temporada', 'Pumpkin Spice Latte',                      NULL, 135, 54, 'BARRA', NULL, NULL),
        ('DIDI', 12, 'Temporada', 'Pumpkin Spice Matcha',                     NULL, 150, 55, 'BARRA', NULL, NULL),

        ('DIDI', 12, 'La Oficina', 'Blue Lover (2 Lattes Maple y Sal fríos)', 'Promo DiDi 2x1 (antes $280)', 140, 61, 'BARRA', NULL, NULL),
        ('DIDI', 12, 'La Oficina', 'The Perfect Match',                       NULL, 150, 62, 'BARRA', NULL, NULL)
      ) AS m(categoria, cat_orden, subcategoria, nombre, descripcion, precio, orden, estacion, modelo_cat, modelo_nombre)
      ORDER BY cat_orden, orden
    LOOP
      -- 1. Categoría: la existente con ese nombre (activa primero) o una nueva.
      SELECT c.id INTO v_cat_id
      FROM categorias_producto c
      WHERE c."empresaId" = emp.id
        AND lower(translate(trim(c.nombre), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'))
          = lower(translate(trim(item.categoria), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'))
      ORDER BY c.activo DESC, c.id
      LIMIT 1;

      IF v_cat_id IS NULL THEN
        v_cat_id := md5('h421-cat-' || emp.id || '-' || lower(item.categoria))::uuid::text;
        INSERT INTO categorias_producto (id, "empresaId", nombre, orden, activo)
        VALUES (v_cat_id, emp.id, item.categoria, item.cat_orden, true)
        ON CONFLICT (id) DO NOTHING;
      END IF;
      -- Una categoría vacía no se ve en los botones del APK, así que activarla no la muestra
      -- en las otras sucursales (todos sus productos nuevos van en standby allá).
      UPDATE categorias_producto SET activo = true WHERE id = v_cat_id AND activo = false;

      -- 2. Producto: el existente en esa categoría con ese nombre (activo primero) o uno nuevo.
      SELECT p.id INTO v_prod_id
      FROM productos p
      WHERE p."empresaId" = emp.id AND p."categoriaId" = v_cat_id
        AND lower(translate(trim(p.nombre), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'))
          = lower(translate(trim(item.nombre), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'))
      ORDER BY p.activo DESC, p.id
      LIMIT 1;

      v_nuevo := v_prod_id IS NULL;

      IF v_nuevo THEN
        v_modelo_id := NULL;
        IF item.modelo_nombre IS NOT NULL THEN
          SELECT p.id INTO v_modelo_id
          FROM productos p JOIN categorias_producto c ON c.id = p."categoriaId"
          WHERE p."empresaId" = emp.id
            AND lower(translate(trim(c.nombre), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'))
              = lower(translate(trim(item.modelo_cat), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'))
            AND lower(translate(trim(p.nombre), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'))
              = lower(translate(trim(item.modelo_nombre), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'))
          ORDER BY p.activo DESC, p.id
          LIMIT 1;
        END IF;

        v_prod_id := md5('h421-prod-' || emp.id || '-' || lower(item.categoria) || '-' || lower(item.nombre))::uuid::text;
        INSERT INTO productos (id, "empresaId", "categoriaId", nombre, descripcion, subcategoria, "precioBase",
                               orden, activo, "requierePersonalizacion", "estacionPreparacion", "createdAt", "updatedAt")
        VALUES (v_prod_id, emp.id, v_cat_id, item.nombre, item.descripcion, item.subcategoria, item.precio,
                item.orden, true,
                v_modelo_id IS NOT NULL AND EXISTS (SELECT 1 FROM producto_modificadores pm WHERE pm."productoId" = v_modelo_id),
                item.estacion::"EstacionPreparacion", now(), now())
        ON CONFLICT (id) DO NOTHING;

        IF v_modelo_id IS NOT NULL THEN
          INSERT INTO producto_modificadores (id, "productoId", "modificadorId", orden)
          SELECT md5('h421-pm-' || v_prod_id || '-' || pm."modificadorId")::uuid::text, v_prod_id, pm."modificadorId", pm.orden
          FROM producto_modificadores pm
          WHERE pm."productoId" = v_modelo_id
          ON CONFLICT DO NOTHING;
        END IF;
      ELSIF NOT (SELECT activo FROM productos WHERE id = v_prod_id) THEN
        -- Estaba dado de baja en todo el catálogo: se reactiva, y el paso 3 lo deja en standby
        -- en las sucursales que no tenían precio propio para que no aparezca de golpe allá.
        UPDATE productos SET activo = true, "updatedAt" = now() WHERE id = v_prod_id;
        v_nuevo := true;
      END IF;

      -- 3. Nuevo (o reactivado): en standby en las sucursales que no son Benito Juárez.
      IF v_nuevo THEN
        INSERT INTO productos_sucursal (id, "productoId", "sucursalId", precio, disponible, "stockControlado")
        SELECT md5('h421-ps-' || v_prod_id || '-' || s.id)::uuid::text, v_prod_id, s.id, item.precio, false, false
        FROM sucursales s
        WHERE s."empresaId" = emp.id
          AND lower(translate(s.nombre, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) NOT LIKE '%benito%'
        ON CONFLICT ("productoId", "sucursalId") DO NOTHING;
      END IF;

      -- 4. En venta en Benito Juárez con el precio del menú.
      INSERT INTO productos_sucursal (id, "productoId", "sucursalId", precio, disponible, "stockControlado")
      SELECT md5('h421-ps-' || v_prod_id || '-' || s.id)::uuid::text, v_prod_id, s.id, item.precio, true, false
      FROM sucursales s
      WHERE s."empresaId" = emp.id
        AND lower(translate(s.nombre, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) LIKE '%benito%'
      ON CONFLICT ("productoId", "sucursalId") DO UPDATE SET precio = EXCLUDED.precio, disponible = true;

      v_menu_ids := array_append(v_menu_ids, v_prod_id);
    END LOOP;

    -- 5. Todo lo que no está en el menú: STANDBY en Benito Juárez (no se borra, no se desactiva).
    INSERT INTO productos_sucursal (id, "productoId", "sucursalId", precio, disponible, "stockControlado")
    SELECT md5('h421-ps-' || p.id || '-' || s.id)::uuid::text, p.id, s.id, p."precioBase", false, false
    FROM productos p
    JOIN sucursales s ON s."empresaId" = p."empresaId"
    WHERE p."empresaId" = emp.id
      AND p.activo = true
      AND NOT (p.id = ANY (v_menu_ids))
      AND lower(translate(s.nombre, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) LIKE '%benito%'
    ON CONFLICT ("productoId", "sucursalId") DO UPDATE SET disponible = false;
  END LOOP;
END $$;
