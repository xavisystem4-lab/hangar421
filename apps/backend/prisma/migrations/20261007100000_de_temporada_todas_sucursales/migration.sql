-- "De Temporada" EN VENTA EN TODAS LAS SUCURSALES. Migración de DATOS.
--
-- 20261006180000_temporada_y_precios_didi_bj dio de alta el grupo De Temporada en venta solo en
-- Benito Juárez y en STANDBY en las demás sucursales, así que allá la categoría no aparecía en
-- los botones del APK. El negocio lo quiere en todas.
--
-- Pone en venta cada producto activo de la categoría De Temporada (nombre normalizado) en todas
-- las sucursales de la empresa: actualiza la disponibilidad donde ya hay fila y, donde no la hay,
-- la crea con el precio base. No cambia precios existentes ni toca otras categorías (el grupo
-- DIDI sigue solo en Benito Juárez). Idempotente. Un solo bloque DO (el backend embebido del POS
-- de Windows aplica sentencia por sentencia).
--
-- El APK descarga el catálogo completo en cada refresco (/catalogo/productos), así que lo toma
-- solo, sin reinstalar.

DO $$
BEGIN
  -- 1. Donde ya hay precio por sucursal (el standby que dejó la migración anterior): en venta.
  UPDATE productos_sucursal ps
  SET disponible = true
  FROM productos p
  JOIN categorias_producto c ON c.id = p."categoriaId"
  JOIN sucursales s ON s."empresaId" = p."empresaId"
  WHERE ps."productoId" = p.id
    AND ps."sucursalId" = s.id
    AND p.activo = true
    AND lower(translate(trim(c.nombre), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) = 'de temporada'
    AND ps.disponible = false;

  -- 2. Sucursales sin fila (p. ej. dadas de alta después): se crea en venta con el precio base.
  INSERT INTO productos_sucursal (id, "productoId", "sucursalId", precio, disponible, "stockControlado")
  SELECT md5('h421-ps-' || p.id || '-' || s.id)::uuid::text, p.id, s.id, p."precioBase", true, false
  FROM productos p
  JOIN categorias_producto c ON c.id = p."categoriaId"
  JOIN sucursales s ON s."empresaId" = p."empresaId"
  WHERE p.activo = true
    AND lower(translate(trim(c.nombre), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) = 'de temporada'
  ON CONFLICT ("productoId", "sucursalId") DO UPDATE SET disponible = true;

  -- 3. La categoría, activa (ya lo dejó así la migración anterior; por si alguien la apagó).
  UPDATE categorias_producto
  SET activo = true
  WHERE lower(translate(trim(nombre), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) = 'de temporada'
    AND activo = false;
END $$;
