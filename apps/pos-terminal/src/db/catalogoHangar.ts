import type { SQLiteDatabase } from "expo-sqlite";
import { generarSlug } from "./busqueda";
import { obtenerConfig, guardarConfig } from "./configLocalRepo";

/** Catálogo REAL de HANGAR 421 Coffee Shop, copiado de la única fuente que lo define hoy:
 *  apps/backend/src/bootstrap/seed-demo-data.ts (`categoriasData` / `productosData`) — el mismo
 *  que el POS de Windows muestra en modo standalone, porque su backend embebido corre ese seed
 *  al arrancar por primera vez.
 *
 *  Está duplicado aquí a propósito, no importado: `packages/shared` contiene tipos y cálculos,
 *  no datos de negocio, y el APK no puede alcanzar la base de la PC (cada uno tiene la suya).
 *  Si el menú cambia en el backend, hay que actualizar esta lista — catalogoHangar.spec.ts
 *  fija el conteo por categoría para que un cambio de un lado no pase desapercibido.
 *
 *  Lo que NO se copia: modificadores/personalización (el modal de tamaño, leche, jarabes…),
 *  estación de preparación y recetas de inventario. La pantalla de venta del APK agrega el
 *  producto directo al carrito; traer los modificadores es un cambio aparte y bastante mayor. */

export interface CategoriaHangar {
  nombre: string;
  orden: number;
}

export interface ProductoHangar {
  nombre: string;
  categoria: string;
  /** Distingue homónimos dentro de una categoría: "Pistache" es galleta (80) y rol (155). */
  subcategoria?: string;
  precio: number;
  orden: number;
}

export const CATEGORIAS_HANGAR: CategoriaHangar[] = [
  { nombre: "Combos", orden: 1 },
  { nombre: "Bebidas frías", orden: 2 },
  { nombre: "Bebidas calientes", orden: 3 },
  { nombre: "Postres", orden: 4 },
  { nombre: "Refresher", orden: 5 },
  { nombre: "Para llevar", orden: 6 },
  { nombre: "Extras", orden: 7 },
];

export const PRODUCTOS_HANGAR: ProductoHangar[] = [
  // Bebidas frías
  { nombre: "Latte", categoria: "Bebidas frías", precio: 85, orden: 1 },
  { nombre: "Americano", categoria: "Bebidas frías", precio: 80, orden: 2 },
  { nombre: "Chai", categoria: "Bebidas frías", precio: 90, orden: 3 },
  { nombre: "Dirty Chai", categoria: "Bebidas frías", precio: 105, orden: 4 },
  { nombre: "Latte Maple y Sal", categoria: "Bebidas frías", precio: 100, orden: 5 },
  { nombre: "Latte Amanecer", categoria: "Bebidas frías", precio: 125, orden: 6 },
  { nombre: "Latte Chicago", categoria: "Bebidas frías", precio: 100, orden: 7 },
  { nombre: "Matcha Iced Latte", categoria: "Bebidas frías", precio: 95, orden: 8 },
  { nombre: "Espresso Tonic", categoria: "Bebidas frías", precio: 90, orden: 9 },
  { nombre: "Cold Brew Black Honey", categoria: "Bebidas frías", precio: 80, orden: 10 },

  // Bebidas calientes
  { nombre: "Latte", categoria: "Bebidas calientes", precio: 70, orden: 1 },
  { nombre: "Americano", categoria: "Bebidas calientes", precio: 50, orden: 2 },
  { nombre: "Chai", categoria: "Bebidas calientes", precio: 85, orden: 3 },
  { nombre: "Dirty Chai", categoria: "Bebidas calientes", precio: 100, orden: 4 },
  { nombre: "Flat White", categoria: "Bebidas calientes", precio: 70, orden: 5 },
  { nombre: "Capuccino", categoria: "Bebidas calientes", precio: 85, orden: 6 },
  { nombre: "Matcha", categoria: "Bebidas calientes", precio: 80, orden: 7 },

  // Refresher
  { nombre: "Nebula Tonic", categoria: "Refresher", precio: 105, orden: 1 },
  { nombre: "Coco Matcha Cloud", categoria: "Refresher", precio: 100, orden: 2 },
  { nombre: "Dirty Piña Colada", categoria: "Refresher", precio: 110, orden: 3 },

  // Para llevar
  { nombre: "To Go", categoria: "Para llevar", precio: 115, orden: 1 },
  { nombre: "Bomba", categoria: "Para llevar", precio: 55, orden: 2 },

  // Postres — Galletas by Domingo
  { nombre: "Macadamia", categoria: "Postres", subcategoria: "Galletas by Domingo", precio: 75, orden: 1 },
  { nombre: "Chispas y Nuez", categoria: "Postres", subcategoria: "Galletas by Domingo", precio: 65, orden: 2 },
  { nombre: "Pistache", categoria: "Postres", subcategoria: "Galletas by Domingo", precio: 80, orden: 3 },

  // Postres — Roles de Canela by Törtchen
  { nombre: "Queso Crema", categoria: "Postres", subcategoria: "Roles de Canela by Törtchen", precio: 145, orden: 4 },
  { nombre: "Pistache", categoria: "Postres", subcategoria: "Roles de Canela by Törtchen", precio: 155, orden: 5 },

  // Postres — Chunky Cookies
  { nombre: "Red Velvet", categoria: "Postres", subcategoria: "Chunky Cookies", precio: 55, orden: 6 },
  { nombre: "Zanahoria", categoria: "Postres", subcategoria: "Chunky Cookies", precio: 50, orden: 7 },

  // Combos — "Solo Bagel" se repite con dos precios (una variante por combo), igual que en el
  // backend: ahí la llave natural es (nombre, precio) por exactamente este caso.
  { nombre: "H & T", categoria: "Combos", precio: 250, orden: 1 },
  { nombre: "Solo Bagel", categoria: "Combos", subcategoria: "Variante de H & T", precio: 155, orden: 2 },
  { nombre: "BnE & T", categoria: "Combos", precio: 250, orden: 3 },
  { nombre: "Solo Bagel", categoria: "Combos", subcategoria: "Variante de BnE & T", precio: 140, orden: 4 },

  // Extras
  { nombre: "Café de bebé (choco milk)", categoria: "Extras", precio: 40, orden: 1 },
];

/** Ids deterministas: se recalculan en cada arranque y deben caer siempre en la misma fila, por
 *  eso derivan del contenido y no de uuid7() (que daría uno nuevo cada vez). Llevan prefijo
 *  `hangar-` para que se distingan a simple vista de los UUID que manda el ERP. */
export function idCategoriaHangar(nombre: string): string {
  return `hangar-cat-${generarSlug(nombre)}`;
}

/** Incluye categoría y precio porque el nombre solo NO es único: "Latte" está en frías (85) y
 *  calientes (70), "Pistache" es galleta (80) y rol (155), "Solo Bagel" vale 155 y 140. */
export function idProductoHangar(producto: ProductoHangar): string {
  return `hangar-prod-${generarSlug(producto.categoria)}-${generarSlug(producto.nombre)}-${producto.precio}`;
}

const CLAVE_SEMBRADO = "catalogo_hangar_sembrado";

/** Escribe el catálogo en la base local del dispositivo. Upsert por id — correrlo dos veces no
 *  duplica nada. Marca las filas con `origen = 'LOCAL'` para que, si algún día se enlaza el ERP,
 *  se puedan retirar sin tocar lo que venga de allá (ver catalogoSyncRepo.upsertCatalogo). */
export async function sembrarCatalogoHangar(db: SQLiteDatabase): Promise<number> {
  const ahora = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    for (const categoria of CATEGORIAS_HANGAR) {
      await db.runAsync(
        `INSERT INTO categorias_producto (id, nombre, orden, activo, origen, synced_at) VALUES (?, ?, ?, 1, 'LOCAL', ?)
         ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre, orden = excluded.orden, activo = 1`,
        idCategoriaHangar(categoria.nombre), categoria.nombre, categoria.orden, ahora,
      );
    }
    for (const producto of PRODUCTOS_HANGAR) {
      await db.runAsync(
        `INSERT INTO productos (id, categoria_id, nombre, subcategoria, precio_base, tasa_impuesto, orden, activo, origen, synced_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, 1, 'LOCAL', ?)
         ON CONFLICT(id) DO UPDATE SET categoria_id = excluded.categoria_id, nombre = excluded.nombre,
           subcategoria = excluded.subcategoria, precio_base = excluded.precio_base, orden = excluded.orden, activo = 1`,
        idProductoHangar(producto), idCategoriaHangar(producto.categoria), producto.nombre,
        producto.subcategoria ?? null, producto.precio, producto.orden, ahora,
      );
    }
  });
  return PRODUCTOS_HANGAR.length;
}

/** Siembra el catálogo UNA sola vez en la vida del dispositivo, no "cada vez que esté vacío":
 *  si el negocio borra productos desde Admin → Catálogo, no deben reaparecer solos en el
 *  siguiente arranque. La marca vive en config_local, junto al resto de la configuración del
 *  dispositivo. La llama abrirBaseDeDatos() justo después de migrar. */
export async function sembrarCatalogoSiHaceFalta(db: SQLiteDatabase): Promise<number> {
  if ((await obtenerConfig(db, CLAVE_SEMBRADO)) === "1") return 0;
  const sembrados = await sembrarCatalogoHangar(db);
  await guardarConfig(db, CLAVE_SEMBRADO, "1");
  return sembrados;
}
