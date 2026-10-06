-- Sucursal BENITO JUÁREZ: precios nuevos en DiDi (Noir PB $170, DTO $140) y grupo nuevo
-- "De Temporada" (bebidas y postres de temporada, menú de mostrador). Migración de DATOS.
--
-- Mismo mecanismo que 20261006120000_menu_benito_juarez_y_didi (pasos 1 a 4): busca por nombre
-- normalizado, crea lo que falta con ids deterministas, lo deja EN VENTA en Benito Juárez con el
-- precio indicado y en STANDBY en las demás sucursales si es nuevo. A diferencia de aquella, NO
-- pone nada en standby: solo agrega o cambia precio, el resto del catálogo queda como está.
-- Idempotente. Un solo bloque DO (el backend embebido del POS de Windows aplica sentencia por
-- sentencia).

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
        ('DIDI', 12, 'Especialidades del Hangar', 'Noir PB', NULL, 170, 2, 'BARRA', NULL, NULL),
        ('DIDI', 12, 'Especialidades del Hangar', 'DTO',     NULL, 140, 4, 'BARRA', NULL, NULL),

        ('De Temporada', 13, 'Bebidas de temporada', 'Pumpkin Spice Latte',           NULL, 100, 1, 'BARRA', NULL, NULL),
        ('De Temporada', 13, 'Bebidas de temporada', 'Pumpkin Spice Matcha',          NULL, 110, 2, 'BARRA', NULL, NULL),
        ('De Temporada', 13, 'Bebidas de temporada', 'S''mores Latte',                NULL, 100, 3, 'BARRA', NULL, NULL),
        ('De Temporada', 13, 'Bebidas de temporada', 'Matcha Cold Foam Pumpkin Spice', NULL, 110, 4, 'BARRA', NULL, NULL),
        ('De Temporada', 13, 'Bebidas de temporada', 'Spooky Latte',                  NULL, 100, 5, 'BARRA', NULL, NULL),
        ('De Temporada', 13, 'Postres de temporada', 'Muffin Calabaza',               NULL, 80, 11, 'POSTRES', NULL, NULL),
        ('De Temporada', 13, 'Postres de temporada', 'Muffin Zanahoria',              NULL, 80, 12, 'POSTRES', NULL, NULL)
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
  END LOOP;
END $$;
