import type { SQLiteDatabase } from "expo-sqlite";

export interface VentaResumen {
  id: string;
  folioLocal: number;
  total: number;
  estado: string;
  createdAt: string;
}

export async function listarVentasRecientes(db: SQLiteDatabase, limite = 50): Promise<VentaResumen[]> {
  const filas = await db.getAllAsync<any>("SELECT id, folio_local, total, estado, created_at FROM ventas ORDER BY created_at DESC LIMIT ?", limite);
  return filas.map((f) => ({ id: f.id, folioLocal: f.folio_local, total: f.total, estado: f.estado, createdAt: f.created_at }));
}
