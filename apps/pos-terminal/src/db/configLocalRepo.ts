import type { SQLiteDatabase } from "expo-sqlite";

export async function obtenerConfig(db: SQLiteDatabase, clave: string): Promise<string | null> {
  const fila = await db.getFirstAsync<{ valor: string }>("SELECT valor FROM config_local WHERE clave = ?", clave);
  return fila?.valor ?? null;
}

export async function guardarConfig(db: SQLiteDatabase, clave: string, valor: string): Promise<void> {
  await db.runAsync("INSERT INTO config_local (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor", clave, valor);
}
