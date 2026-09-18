import type { SQLiteDatabase } from "expo-sqlite";

interface CategoriaRemota { id: string; nombre: string; orden: number; activo: boolean }
interface ProductoRemoto { id: string; categoriaId: string; nombre: string; precioBase: number; precioSucursal?: number; activo: boolean; disponibleSucursal?: boolean }

/** Reemplaza el catálogo local con lo que trae el ERP — mismas filas que ya leen
 *  catalogoRepo.listarCategorias/listarProductos. No se borra nada que no venga en la respuesta
 *  por accidente: se hace upsert por id, nunca DELETE masivo (un producto que el ERP dejó de
 *  mandar por un filtro raro no debe desaparecer de golpe del POS). */
export async function upsertCatalogo(db: SQLiteDatabase, categorias: CategoriaRemota[], productos: ProductoRemoto[]): Promise<void> {
  const ahora = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    for (const c of categorias) {
      await db.runAsync(
        `INSERT INTO categorias_producto (id, nombre, orden, activo, updated_at_server, synced_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre, orden = excluded.orden, activo = excluded.activo, updated_at_server = excluded.updated_at_server, synced_at = excluded.synced_at`,
        c.id, c.nombre, c.orden, c.activo ? 1 : 0, ahora, ahora,
      );
    }
    for (const p of productos) {
      const precio = p.precioSucursal ?? p.precioBase;
      const activo = p.activo && p.disponibleSucursal !== false;
      await db.runAsync(
        `INSERT INTO productos (id, categoria_id, nombre, precio_base, tasa_impuesto, activo, updated_at_server, synced_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET categoria_id = excluded.categoria_id, nombre = excluded.nombre, precio_base = excluded.precio_base, activo = excluded.activo, updated_at_server = excluded.updated_at_server, synced_at = excluded.synced_at`,
        p.id, p.categoriaId, p.nombre, precio, activo ? 1 : 0, ahora, ahora,
      );
    }
  });
}

interface MesaRemota { id: string; nombre: string; estado: string; orden?: number }

export async function upsertMesas(db: SQLiteDatabase, mesas: MesaRemota[]): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const m of mesas) {
      await db.runAsync(
        `INSERT INTO mesas (id, nombre, estado, orden) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre, estado = excluded.estado`,
        m.id, m.nombre, m.estado, m.orden ?? 0,
      );
    }
  });
}
