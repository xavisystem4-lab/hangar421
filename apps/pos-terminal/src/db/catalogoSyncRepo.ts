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

/**
 * Repunta las ventas ya encoladas que referencian productos del catálogo SEMBRADO en el
 * dispositivo (ids `hangar-prod-*`) hacia el id real del ERP.
 *
 * Es la causa por la que una venta hecha antes de enlazar no aparecía nunca en el ERP:
 * `PedidosService.resolverItem` rechaza el pedido entero con "Uno de los productos del pedido ya
 * no existe en el catálogo", porque ese id solo existe en la tablet. El item quedaba en ERROR y
 * se reintentaba para siempre con el mismo resultado.
 *
 * El emparejamiento es por NOMBRE + PRECIO, que es la misma llave natural que usa el seed del
 * backend para sus propios productos ("Solo Bagel" existe dos veces con precios distintos). Si no
 * hay una coincidencia exacta y única, la línea se deja como está: es preferible una venta
 * atascada y visible a una venta que se sincroniza apuntando al producto equivocado.
 */
export async function repararProductosLocalesEnOutbox(db: SQLiteDatabase): Promise<number> {
  const pendientes = await db.getAllAsync<{ local_id: string; payload: string }>(
    "SELECT local_id, payload FROM sync_outbox WHERE estado IN ('PENDING','ERROR') AND payload LIKE '%hangar-prod-%'",
  );
  if (pendientes.length === 0) return 0;

  // Candidatos del ERP: los del catálogo que NO son los sembrados localmente.
  const delErp = await db.getAllAsync<{ id: string; nombre: string; precio_base: number }>(
    "SELECT id, nombre, precio_base FROM productos WHERE origen = 'ERP' AND activo = 1",
  );
  if (delErp.length === 0) return 0;

  const porNombrePrecio = new Map<string, string[]>();
  for (const p of delErp) {
    const clave = `${p.nombre.trim().toLowerCase()}#${Number(p.precio_base).toFixed(2)}`;
    porNombrePrecio.set(clave, [...(porNombrePrecio.get(clave) ?? []), p.id]);
  }

  // Nombre y precio de los productos locales, para poder construir la clave de búsqueda.
  const locales = await db.getAllAsync<{ id: string; nombre: string; precio_base: number }>(
    "SELECT id, nombre, precio_base FROM productos WHERE origen = 'LOCAL'",
  );
  const infoLocal = new Map(locales.map((p) => [p.id, p]));

  let reparadas = 0;
  for (const fila of pendientes) {
    try {
      const payload = JSON.parse(fila.payload);
      if (!Array.isArray(payload?.items)) continue;

      let cambiado = false;
      let irresoluble = false;
      for (const item of payload.items) {
        if (typeof item?.productoId !== "string" || !item.productoId.startsWith("hangar-prod-")) continue;
        const local = infoLocal.get(item.productoId);
        if (!local) { irresoluble = true; continue; }
        const candidatos = porNombrePrecio.get(`${local.nombre.trim().toLowerCase()}#${Number(local.precio_base).toFixed(2)}`);
        // Exactamente uno: con dos coincidencias no hay forma de saber cuál cobró el cajero.
        if (candidatos?.length === 1) {
          item.productoId = candidatos[0];
          cambiado = true;
        } else {
          irresoluble = true;
        }
      }

      // Se guarda solo si TODAS las líneas quedaron resueltas: mandar un pedido a medias lo
      // volvería a rechazar entero y encima habríamos perdido el rastro de qué faltaba.
      if (cambiado && !irresoluble) {
        await db.runAsync(
          "UPDATE sync_outbox SET payload = ?, estado = 'PENDING', ultimo_error = NULL, next_retry_at = NULL WHERE local_id = ?",
          JSON.stringify(payload), fila.local_id,
        );
        reparadas += 1;
      }
    } catch {
      // Un payload ilegible no debe impedir reparar los demás.
    }
  }
  return reparadas;
}
