import type { SQLiteDatabase } from "expo-sqlite";

interface CategoriaRemota { id: string; nombre: string; orden: number; activo: boolean }
interface OpcionRemota { id: string; nombre: string; precioExtra: number; orden: number }
interface ModificadorRemoto { id: string; nombre: string; tipo: string; obligatorio: boolean; opciones: OpcionRemota[] }
interface ProductoRemoto {
  id: string; categoriaId: string; nombre: string; subcategoria?: string | null; orden?: number;
  precioBase: number; precioSucursal?: number; activo: boolean; disponibleSucursal?: boolean;
  requierePersonalizacion?: boolean; modificadores?: ModificadorRemoto[];
}

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
        `INSERT INTO productos (id, categoria_id, nombre, subcategoria, precio_base, tasa_impuesto, orden, activo, requiere_personalizacion, origen, updated_at_server, synced_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 'ERP', ?, ?)
         ON CONFLICT(id) DO UPDATE SET categoria_id = excluded.categoria_id, nombre = excluded.nombre, subcategoria = excluded.subcategoria, precio_base = excluded.precio_base, orden = excluded.orden, activo = excluded.activo, requiere_personalizacion = excluded.requiere_personalizacion, updated_at_server = excluded.updated_at_server, synced_at = excluded.synced_at`,
        p.id, p.categoriaId, p.nombre, p.subcategoria ?? null, precio, p.orden ?? 0, activo ? 1 : 0,
        p.requierePersonalizacion ? 1 : 0, ahora, ahora,
      );

      // Modificadores del producto. El endpoint los devuelve anidados en cada producto (ver
      // catalogo.service.listarProductosPorSucursal), así que un mismo modificador llega
      // repetido en varios: el upsert por id lo vuelve idempotente.
      //
      // El vínculo producto→modificador sí se reemplaza entero: si el ERP dejó de preguntar el
      // tamaño en un producto, ese vínculo tiene que desaparecer, no quedarse pegado. Los
      // modificadores y sus opciones NO se borran — hay ventas históricas que los referencian.
      await db.runAsync("DELETE FROM producto_modificadores WHERE producto_id = ?", p.id);
      let ordenModificador = 1;
      for (const m of p.modificadores ?? []) {
        await db.runAsync(
          `INSERT INTO modificadores (id, nombre, tipo, obligatorio, activo, origen, synced_at) VALUES (?, ?, ?, ?, 1, 'ERP', ?)
           ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre, tipo = excluded.tipo, obligatorio = excluded.obligatorio, activo = 1, synced_at = excluded.synced_at`,
          m.id, m.nombre, m.tipo, m.obligatorio ? 1 : 0, ahora,
        );
        for (const o of m.opciones ?? []) {
          await db.runAsync(
            `INSERT INTO opciones_modificador (id, modificador_id, nombre, precio_extra, orden) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET modificador_id = excluded.modificador_id, nombre = excluded.nombre, precio_extra = excluded.precio_extra, orden = excluded.orden`,
            o.id, m.id, o.nombre, Number(o.precioExtra), o.orden ?? 0,
          );
        }
        await db.runAsync(
          "INSERT INTO producto_modificadores (producto_id, modificador_id, orden) VALUES (?, ?, ?)",
          p.id, m.id, ordenModificador++,
        );
      }
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
      await db.runAsync("UPDATE modificadores SET activo = 0 WHERE origen = 'LOCAL' AND activo = 1");
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
