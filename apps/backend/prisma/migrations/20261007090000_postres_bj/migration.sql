-- Sucursal BENITO JUÁREZ, grupo Postres: se agregan Galletas Costco ($80) y Strudel ($40), el
-- Muffin de Plátano baja a $75, y Roles de canela y Chunky Cookies quedan en STANDBY (no se
-- borran; se reactivan desde Admin → Catálogo). El Brownie ($60) y los grupos de temporada ya
-- estaban en venta: no se tocan. Migración de DATOS, idempotente, un solo bloque DO (mismo
-- mecanismo que 20261006180000_temporada_y_precios_didi_bj).

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
        ('Postres', 4, NULL, 'Galletas Costco',    NULL,          80, 3, 'POSTRES', NULL, NULL),
        ('Postres', 4, NULL, 'Strudel',            NULL,          40, 4, 'POSTRES', NULL, NULL),
        ('Postres', 4, NULL, 'Muffin de Plátano',  'Gluten free', 75, 1, 'POSTRES', NULL, NULL)
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

    -- Roles de canela y Chunky Cookies: STANDBY en Benito Juárez.
    INSERT INTO productos_sucursal (id, "productoId", "sucursalId", precio, disponible, "stockControlado")
    SELECT md5('h421-ps-' || p.id || '-' || s.id)::uuid::text, p.id, s.id, p."precioBase", false, false
    FROM productos p
    JOIN categorias_producto c ON c.id = p."categoriaId"
    JOIN sucursales s ON s."empresaId" = p."empresaId"
    WHERE p."empresaId" = emp.id
      AND lower(translate(c.nombre, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) = 'postres'
      AND (
        lower(translate(coalesce(p.subcategoria, ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) LIKE '%roles de canela%'
        OR lower(coalesce(p.subcategoria, '')) LIKE '%chunky%'
        OR lower(translate(p.nombre, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) LIKE '%rol de canela%'
        OR lower(p.nombre) LIKE '%chunky%'
      )
      AND lower(translate(s.nombre, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) LIKE '%benito%'
    ON CONFLICT ("productoId", "sucursalId") DO UPDATE SET disponible = false;
  END LOOP;
END $$;
