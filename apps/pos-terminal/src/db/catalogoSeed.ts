import type { SQLiteDatabase } from "expo-sqlite";
import { uuid7 } from "@hangar421/shared";

/** Catálogo sembrado a mano — Fase 1 todavía no tiene /sync/pull conectado (eso es Fase 2a), así
 *  que no hay forma real de traer categorías/productos de la sucursal. Esto es SOLO para poder
 *  probar el flujo de venta de punta a punta en esta fase; en cuanto Fase 2a traiga el catálogo
 *  real por sync, esta siembra deja de usarse (no se borra el catálogo ya sincronizado). */
export async function sembrarCatalogoDemo(db: SQLiteDatabase): Promise<void> {
  const { total } = (await db.getFirstAsync<{ total: number }>("SELECT COUNT(*) as total FROM productos")) ?? { total: 0 };
  if (total > 0) return;

  const ahora = new Date().toISOString();
  const categorias = [
    { id: uuid7(), nombre: "Bebidas", orden: 1 },
    { id: uuid7(), nombre: "Alimentos", orden: 2 },
  ];
  const productos = [
    { id: uuid7(), categoriaId: categorias[0].id, nombre: "Café americano", precio: 35 },
    { id: uuid7(), categoriaId: categorias[0].id, nombre: "Latte", precio: 49 },
    { id: uuid7(), categoriaId: categorias[0].id, nombre: "Agua fresca", precio: 30 },
    { id: uuid7(), categoriaId: categorias[1].id, nombre: "Croissant", precio: 55 },
    { id: uuid7(), categoriaId: categorias[1].id, nombre: "Sándwich", precio: 89 },
  ];

  await db.withTransactionAsync(async () => {
    for (const c of categorias) {
      await db.runAsync(
        "INSERT INTO categorias_producto (id, nombre, orden, activo, updated_at_server, synced_at) VALUES (?, ?, ?, 1, ?, ?)",
        c.id, c.nombre, c.orden, ahora, ahora,
      );
    }
    for (const p of productos) {
      await db.runAsync(
        "INSERT INTO productos (id, categoria_id, nombre, precio_base, tasa_impuesto, activo, updated_at_server, synced_at) VALUES (?, ?, ?, ?, 0, 1, ?, ?)",
        p.id, p.categoriaId, p.nombre, p.precio, ahora, ahora,
      );
    }
  });
}
