import * as SQLite from "expo-sqlite";
import { ejecutarMigraciones } from "./migrations";
import { sembrarCatalogoSiHaceFalta } from "./catalogoHangar";

const NOMBRE_ARCHIVO = "hangar421-pos-terminal.db";

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/** Un solo archivo SQLite, en el almacenamiento privado de la app (expo-sqlite resuelve la ruta
 *  sola) — WAL para durabilidad + evitar bloqueos entre la venta y el drenado de sync_outbox en
 *  segundo plano, foreign_keys ON para que las referencias venta_items→ventas, pagos→ventas,
 *  etc. no queden huérfanas por un bug. Se abre una sola vez por proceso (el `Promise` cacheado
 *  evita una carrera si dos pantallas piden la BD casi al mismo tiempo al arrancar). */
export function abrirBaseDeDatos(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(NOMBRE_ARCHIVO);
      await db.execAsync("PRAGMA journal_mode = WAL;");
      await db.execAsync("PRAGMA foreign_keys = ON;");
      await ejecutarMigraciones(db);
      // Deja el catálogo de HANGAR 421 escrito en la base local en el primer arranque, para que
      // la pantalla de venta tenga los mismos productos que el POS de Windows sin depender de
      // ninguna conexión. Solo la primera vez (ver sembrarCatalogoSiHaceFalta).
      await sembrarCatalogoSiHaceFalta(db);
      return db;
    })();
  }
  return dbPromise;
}
