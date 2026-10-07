-- Grupo "De Temporada" (Bebidas y Postres de temporada) EN VENTA en TODAS las sucursales de la
-- empresa — incluida Mecánicos. Antes solo estaba en venta en Benito Juárez y en standby en las
-- demás (20261006180000_temporada_y_precios_didi_bj). Migración de DATOS, idempotente, un solo
-- bloque DO.
--
-- Precio: el del menú de temporada (el precio base del producto), igual en todas las sucursales.
-- Un producto que alguien dio de baja a mano en todo el catálogo se respeta: solo se publican los
-- productos activos del grupo.

DO $$
BEGIN
  INSERT INTO productos_sucursal (id, "productoId", "sucursalId", precio, disponible, "stockControlado")
  SELECT md5('h421-ps-' || p.id || '-' || s.id)::uuid::text, p.id, s.id, p."precioBase", true, false
  FROM productos p
  JOIN categorias_producto c ON c.id = p."categoriaId"
  JOIN sucursales s ON s."empresaId" = p."empresaId"
  WHERE p.activo = true
    AND lower(translate(trim(c.nombre), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) = 'de temporada'
  ON CONFLICT ("productoId", "sucursalId") DO UPDATE SET precio = EXCLUDED.precio, disponible = true;

  -- El grupo debe estar activo para que su botón aparezca.
  UPDATE categorias_producto SET activo = true
  WHERE lower(translate(trim(nombre), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) = 'de temporada' AND activo = false;
END $$;
