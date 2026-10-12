-- Empaque con el que se compra y se cuenta un insumo (cartón de 1000 ml), separado de la unidad
-- en la que se consume (ml). La existencia sigue en la unidad de consumo.
ALTER TABLE "insumos" ADD COLUMN "presentacionNombre" TEXT;
ALTER TABLE "insumos" ADD COLUMN "presentacionCantidad" DECIMAL(12,4);
