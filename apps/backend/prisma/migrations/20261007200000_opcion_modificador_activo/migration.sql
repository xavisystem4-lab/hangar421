-- Quitar una opción de un modificador desde la terminal: si ya se vendió se apaga (el historial la
-- sigue referenciando); si nunca se vendió se borra.
ALTER TABLE "opciones_modificador" ADD COLUMN "activo" BOOLEAN NOT NULL DEFAULT true;
