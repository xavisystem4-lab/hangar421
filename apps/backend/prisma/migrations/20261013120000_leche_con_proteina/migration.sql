-- "Proteína" (Extras de Benito Juárez) pasa a "Leche con Proteína" y, al tocarlo en la tablet,
-- abre la ventana de personalización preguntando el TIPO DE LECHE: se le liga el mismo grupo
-- "Tipo de leche" de las bebidas (obligatorio, con sus precios y su receta por opción para el
-- inventario). Migración de DATOS, idempotente. No toca otras empresas ni otros productos.

DO $$
DECLARE
  emp RECORD;
  v_prod_id TEXT;
  v_mod_id  TEXT;
BEGIN
  FOR emp IN
    SELECT DISTINCT s."empresaId" AS id
    FROM sucursales s
    WHERE lower(translate(s.nombre, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) LIKE '%benito%'
  LOOP
    SELECT p.id INTO v_prod_id
    FROM productos p JOIN categorias_producto c ON c.id = p."categoriaId"
    WHERE p."empresaId" = emp.id
      AND lower(translate(trim(c.nombre), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) = 'extras'
      AND lower(translate(trim(p.nombre), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) IN ('proteina', 'leche con proteina')
    ORDER BY p.activo DESC, p.id
    LIMIT 1;
    CONTINUE WHEN v_prod_id IS NULL;

    SELECT m.id INTO v_mod_id
    FROM modificadores m
    WHERE m."empresaId" = emp.id
      AND lower(translate(trim(m.nombre), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) = 'tipo de leche'
    ORDER BY (SELECT count(*) FROM producto_modificadores pm WHERE pm."modificadorId" = m.id) DESC, m.id
    LIMIT 1;

    UPDATE productos
    SET nombre = 'Leche con Proteína',
        "requierePersonalizacion" = (v_mod_id IS NOT NULL),
        "updatedAt" = now()
    WHERE id = v_prod_id;

    IF v_mod_id IS NOT NULL THEN
      INSERT INTO producto_modificadores (id, "productoId", "modificadorId", orden)
      VALUES (md5('h421-pm-' || v_prod_id || '-' || v_mod_id)::uuid::text, v_prod_id, v_mod_id, 1)
      ON CONFLICT ("productoId", "modificadorId") DO NOTHING;
    END IF;
  END LOOP;
END $$;
