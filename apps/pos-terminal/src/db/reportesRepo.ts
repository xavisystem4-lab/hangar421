import type { SQLiteDatabase } from "expo-sqlite";
import { obtenerOCrearSucursalIdLocal } from "./dispositivoLocal";

export interface ResumenVentas {
  totalVentas: number;
  cantidadVentas: number;
  totalPorMetodo: { metodo: string; total: number; cantidad: number }[];
}

export interface ProductoVendido {
  nombre: string;
  cantidad: number;
  total: number;
}

/** Reportes 100% locales — agregaciones SQL puras sobre lo que ya vive en este dispositivo, sin
 *  depender del ERP (a diferencia de AdminReportes.tsx del POS Windows, que sí consulta al
 *  backend). `desde`/`hasta` son ISO; se comparan directo contra `ventas.created_at` (también
 *  ISO), que SQLite ordena/compara correctamente como texto.
 *
 *  Acotados a la sucursal activa (migración 3): un corte que sumara las ventas de dos sucursales
 *  no cuadraría con el efectivo de ninguna de las dos cajas. */
export async function resumenVentas(db: SQLiteDatabase, desde: string, hasta: string): Promise<ResumenVentas> {
  const sucursalId = await obtenerOCrearSucursalIdLocal(db);
  const total = await db.getFirstAsync<{ total: number; cantidad: number }>(
    "SELECT COALESCE(SUM(total), 0) as total, COUNT(*) as cantidad FROM ventas WHERE sucursal_id = ? AND estado = 'COBRADA' AND created_at BETWEEN ? AND ?",
    sucursalId, desde, hasta,
  );
  const porMetodo = await db.getAllAsync<{ metodo: string; total: number; cantidad: number }>(
    `SELECT p.metodo as metodo, COALESCE(SUM(p.monto), 0) as total, COUNT(*) as cantidad
     FROM pagos p JOIN ventas v ON v.id = p.venta_id
     WHERE v.sucursal_id = ? AND v.estado = 'COBRADA' AND v.created_at BETWEEN ? AND ?
     GROUP BY p.metodo ORDER BY total DESC`,
    sucursalId, desde, hasta,
  );
  return { totalVentas: total?.total ?? 0, cantidadVentas: total?.cantidad ?? 0, totalPorMetodo: porMetodo };
}

export async function topProductosVendidos(db: SQLiteDatabase, desde: string, hasta: string, limite = 10): Promise<ProductoVendido[]> {
  const sucursalId = await obtenerOCrearSucursalIdLocal(db);
  return db.getAllAsync<ProductoVendido>(
    `SELECT vi.nombre_snapshot as nombre, SUM(vi.cantidad) as cantidad, SUM(vi.precio_unit_snapshot * vi.cantidad) as total
     FROM venta_items vi JOIN ventas v ON v.id = vi.venta_id
     WHERE v.sucursal_id = ? AND v.estado = 'COBRADA' AND v.created_at BETWEEN ? AND ?
     GROUP BY vi.producto_id, vi.nombre_snapshot ORDER BY cantidad DESC LIMIT ?`,
    sucursalId, desde, hasta, limite,
  );
}
