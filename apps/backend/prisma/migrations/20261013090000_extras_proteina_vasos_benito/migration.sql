-- EXTRAS de la sucursal BENITO JUÁREZ: Proteína $30, Vaso con hielo $15 y Vaso con agua $10.
-- Migración de DATOS, mismo patrón que 20261006120000_menu_benito_juarez_y_didi:
--   * Van en la categoría "Extras" (la existente; se crea solo si no hay).
--   * En venta en Benito Juárez con ese precio; en standby en las demás sucursales.
--   * Idempotente: se busca el producto por nombre antes de crearlo, ids deterministas (md5) y
--     ON CONFLICT en todo. Una empresa sin sucursal "Benito…" no se toca.
-- Un solo bloque DO, sin tablas temporales (ver la migración del menú).

DO $$
DECLARE
  emp  RECORD;
  item RECORD;
  v_cat_id  TEXT;
  v_prod_id TEXT;
  v_nuevo   BOOLEAN;
BEGIN
  FOR emp IN
    SELECT DISTINCT s."empresaId" AS id
    FROM sucursales s
    WHERE lower(translate(s.nombre, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) LIKE '%benito%'
  LOOP
    SELECT c.id INTO v_cat_id
    FROM categorias_producto c
    WHERE c."empresaId" = emp.id
      AND lower(translate(trim(c.nombre), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) = 'extras'
    ORDER BY c.activo DESC, c.id
    LIMIT 1;

    IF v_cat_id IS NULL THEN
      v_cat_id := md5('h421-cat-' || emp.id || '-extras')::uuid::text;
      INSERT INTO categorias_producto (id, "empresaId", nombre, orden, activo)
      VALUES (v_cat_id, emp.id, 'Extras', 7, true)
      ON CONFLICT (id) DO NOTHING;
    END IF;
    UPDATE categorias_producto SET activo = true WHERE id = v_cat_id AND activo = false;

    FOR item IN
      SELECT * FROM (VALUES
        ('Proteína',       30, 6),
        ('Vaso con hielo', 15, 7),
        ('Vaso con agua',  10, 8)
      ) AS m(nombre, precio, orden)
    LOOP
      SELECT p.id INTO v_prod_id
      FROM productos p
      WHERE p."empresaId" = emp.id AND p."categoriaId" = v_cat_id
        AND lower(translate(trim(p.nombre), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'))
          = lower(translate(trim(item.nombre), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'))
      ORDER BY p.activo DESC, p.id
      LIMIT 1;

      v_nuevo := v_prod_id IS NULL;
      IF v_nuevo THEN
        v_prod_id := md5('h421-prod-' || emp.id || '-extras-' || lower(item.nombre))::uuid::text;
        INSERT INTO productos (id, "empresaId", "categoriaId", nombre, "precioBase", orden, activo,
                               "requierePersonalizacion", "estacionPreparacion", "createdAt", "updatedAt")
        VALUES (v_prod_id, emp.id, v_cat_id, item.nombre, item.precio, item.orden, true, false,
                'BARRA'::"EstacionPreparacion", now(), now())
        ON CONFLICT (id) DO NOTHING;
      ELSIF NOT (SELECT activo FROM productos WHERE id = v_prod_id) THEN
        UPDATE productos SET activo = true, "updatedAt" = now() WHERE id = v_prod_id;
        v_nuevo := true;
      END IF;

      -- Nuevo: en standby en las sucursales que no son Benito Juárez.
      IF v_nuevo THEN
        INSERT INTO productos_sucursal (id, "productoId", "sucursalId", precio, disponible, "stockControlado")
        SELECT md5('h421-ps-' || v_prod_id || '-' || s.id)::uuid::text, v_prod_id, s.id, item.precio, false, false
        FROM sucursales s
        WHERE s."empresaId" = emp.id
          AND lower(translate(s.nombre, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) NOT LIKE '%benito%'
        ON CONFLICT ("productoId", "sucursalId") DO NOTHING;
      END IF;

      -- En venta en Benito Juárez con su precio.
      INSERT INTO productos_sucursal (id, "productoId", "sucursalId", precio, disponible, "stockControlado")
      SELECT md5('h421-ps-' || v_prod_id || '-' || s.id)::uuid::text, v_prod_id, s.id, item.precio, true, false
      FROM sucursales s
      WHERE s."empresaId" = emp.id
        AND lower(translate(s.nombre, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) LIKE '%benito%'
      ON CONFLICT ("productoId", "sucursalId") DO UPDATE SET precio = EXCLUDED.precio, disponible = true;
    END LOOP;
  END LOOP;
END $$;
