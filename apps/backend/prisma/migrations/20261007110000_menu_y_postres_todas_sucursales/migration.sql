-- Menú del PDF y Postres nuevos EN VENTA EN TODAS LAS SUCURSALES. Migración de DATOS.
--
-- 20261006120000_menu_benito_juarez_y_didi (menú del PDF) y 20261007090000_postres_bj (Galletas
-- Costco, Strudel) dieron de alta sus productos NUEVOS en venta solo en Benito Juárez y en
-- STANDBY en las demás sucursales (su paso 3). El negocio los quiere en todas.
--
-- Qué se reconoce como "lo que esas migraciones dejaron en standby": las filas de
-- productos_sucursal con el id determinista que usa ese paso 3,
-- md5('h421-ps-' || productoId || '-' || sucursalId). Una fila que ya existía conservó su id
-- original (ON CONFLICT DO NOTHING), así que lo que alguien tenía apagado a propósito no se
-- enciende. Se excluye la categoría DIDI (sigue solo en Benito Juárez); De Temporada ya lo hizo
-- 20261007100000.
--
-- Además, el Muffin de Plátano pasa a $75 en todas las sucursales, como en Benito Juárez.
--
-- NO se tocan: el standby de Roles de canela y Chunky Cookies, ni el "resto del catálogo en
-- standby" del menú — ambos fueron solo para Benito Juárez.
--
-- Idempotente. Un solo bloque DO (el backend embebido del POS de Windows aplica sentencia por
-- sentencia). El APK descarga el catálogo completo en cada refresco: lo toma sin reinstalar.

DO $$
BEGIN
  -- 1. Productos nuevos del menú y de postres: en venta fuera de Benito Juárez.
  UPDATE productos_sucursal ps
  SET disponible = true
  FROM productos p
  JOIN categorias_producto c ON c.id = p."categoriaId"
  JOIN sucursales s ON s."empresaId" = p."empresaId"
  WHERE ps."productoId" = p.id
    AND ps."sucursalId" = s.id
    AND ps.id = md5('h421-ps-' || p.id || '-' || s.id)::uuid::text
    AND ps.disponible = false
    AND p.activo = true
    AND lower(translate(s.nombre, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) NOT LIKE '%benito%'
    AND lower(translate(trim(c.nombre), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) NOT IN ('didi', 'de temporada');

  -- 2. Muffin de Plátano a $75 en todas las sucursales (donde falte la fila, se crea en venta).
  INSERT INTO productos_sucursal (id, "productoId", "sucursalId", precio, disponible, "stockControlado")
  SELECT md5('h421-ps-' || p.id || '-' || s.id)::uuid::text, p.id, s.id, 75, true, false
  FROM productos p
  JOIN categorias_producto c ON c.id = p."categoriaId"
  JOIN sucursales s ON s."empresaId" = p."empresaId"
  WHERE p.activo = true
    AND lower(translate(trim(c.nombre), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) = 'postres'
    AND lower(translate(trim(p.nombre), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) = 'muffin de platano'
  ON CONFLICT ("productoId", "sucursalId") DO UPDATE SET precio = 75;
END $$;
