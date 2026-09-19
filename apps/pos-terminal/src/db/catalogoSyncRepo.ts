import type { SQLiteDatabase } from "expo-sqlite";

interface CategoriaRemota { id: string; nombre: string; orden: number; activo: boolean }
interface ProductoRemoto { id: string; categoriaId: string; nombre: string; subcategoria?: string | null; orden?: number; precioBase: number; precioSucursal?: number; activo: boolean; disponibleSucursal?: boolean }

/** Reemplaza el catálogo local con lo que trae el ERP — mismas filas que ya leen
 *  catalogoRepo.listarCategorias/listarProductos. No se borra nada que no venga en la respuesta
 *  por accidente: se hace upsert por id, nunca DELETE masivo (un producto que el ERP dejó de
 *  mandar por un filtro raro no debe desaparecer de golpe del POS). */
export async function upsertCatalogo(db: SQLiteDatabase, categorias: CategoriaRemota[], productos: ProductoRemoto[]): Promise<void> {
  const ahora = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    for (const c of categorias) {
      await db.runAsync(
        `INSERT INTO categorias_producto (id, nombre, orden, activo, origen, updated_at_server, synced_at) VALUES (?, ?, ?, ?, 'ERP', ?, ?)
         ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre, orden = excluded.orden, activo = excluded.activo, updated_at_server = excluded.updated_at_server, synced_at = excluded.synced_at`,
        c.id, c.nombre, c.orden, c.activo ? 1 : 0, ahora, ahora,
      );
    }
    for (const p of productos) {
      const precio = p.precioSucursal ?? p.precioBase;
      const activo = p.activo && p.disponibleSucursal !== false;
      await db.runAsync(
        `INSERT INTO productos (id, categoria_id, nombre, subcategoria, precio_base, tasa_impuesto, orden, activo, origen, updated_at_server, synced_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, 'ERP', ?, ?)
         ON CONFLICT(id) DO UPDATE SET categoria_id = excluded.categoria_id, nombre = excluded.nombre, subcategoria = excluded.subcategoria, precio_base = excluded.precio_base, orden = excluded.orden, activo = excluded.activo, updated_at_server = excluded.updated_at_server, synced_at = excluded.synced_at`,
        p.id, p.categoriaId, p.nombre, p.subcategoria ?? null, precio, p.orden ?? 0, activo ? 1 : 0, ahora, ahora,
      );
    }

    // El catálogo sembrado en el dispositivo (catalogoHangar.ts) y el del ERP describen los
    // mismos productos con ids distintos, así que dejarlos conviviendo se ve como un catálogo
    // duplicado. En cuanto el ERP manda un catálogo de verdad, el sembrado local se retira: se
    // desactiva, no se borra, porque hay ventas históricas de este dispositivo que referencian
    // esos ids y deben seguir resolviendo su nombre.
    //
    // Condicionado a que la respuesta traiga productos: una respuesta vacía (empresa recién
    // creada, un filtro que no devolvió nada) dejaría al POS sin catálogo alguno.
    if (productos.length > 0) {
      await db.runAsync("UPDATE productos SET activo = 0 WHERE origen = 'LOCAL' AND activo = 1");
      await db.runAsync("UPDATE categorias_producto SET activo = 0 WHERE origen = 'LOCAL' AND activo = 1");
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
