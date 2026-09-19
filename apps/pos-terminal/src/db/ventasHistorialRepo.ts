import type { SQLiteDatabase } from "expo-sqlite";
import { obtenerOCrearSucursalIdLocal } from "./dispositivoLocal";

export interface VentaResumen {
  id: string;
  folioLocal: number;
  total: number;
  estado: string;
  createdAt: string;
}

/** Acotado a la sucursal activa (migración 3): los folios se reinician por sucursal, así que un
 *  listado mezclado mostraría dos ventas distintas con el mismo número. */
export async function listarVentasRecientes(db: SQLiteDatabase, limite = 50): Promise<VentaResumen[]> {
  const sucursalId = await obtenerOCrearSucursalIdLocal(db);
  const filas = await db.getAllAsync<any>(
    "SELECT id, folio_local, total, estado, created_at FROM ventas WHERE sucursal_id = ? ORDER BY created_at DESC LIMIT ?",
    sucursalId, limite,
  );
  return filas.map((f) => ({ id: f.id, folioLocal: f.folio_local, total: f.total, estado: f.estado, createdAt: f.created_at }));
}
