import type { SQLiteDatabase } from "expo-sqlite";

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
 *  ISO), que SQLite ordena/compara correctamente como texto. */
export async function resumenVentas(db: SQLiteDatabase, desde: string, hasta: string): Promise<ResumenVentas> {
  const total = await db.getFirstAsync<{ total: number; cantidad: number }>(
    "SELECT COALESCE(SUM(total), 0) as total, COUNT(*) as cantidad FROM ventas WHERE estado = 'COBRADA' AND created_at BETWEEN ? AND ?",
    desde, hasta,
  );
  const porMetodo = await db.getAllAsync<{ metodo: string; total: number; cantidad: number }>(
    `SELECT p.metodo as metodo, COALESCE(SUM(p.monto), 0) as total, COUNT(*) as cantidad
     FROM pagos p JOIN ventas v ON v.id = p.venta_id
     WHERE v.estado = 'COBRADA' AND v.created_at BETWEEN ? AND ?
     GROUP BY p.metodo ORDER BY total DESC`,
    desde, hasta,
  );
  return { totalVentas: total?.total ?? 0, cantidadVentas: total?.cantidad ?? 0, totalPorMetodo: porMetodo };
}

export async function topProductosVendidos(db: SQLiteDatabase, desde: string, hasta: string, limite = 10): Promise<ProductoVendido[]> {
  return db.getAllAsync<ProductoVendido>(
    `SELECT vi.nombre_snapshot as nombre, SUM(vi.cantidad) as cantidad, SUM(vi.precio_unit_snapshot * vi.cantidad) as total
     FROM venta_items vi JOIN ventas v ON v.id = vi.venta_id
     WHERE v.estado = 'COBRADA' AND v.created_at BETWEEN ? AND ?
     GROUP BY vi.producto_id, vi.nombre_snapshot ORDER BY cantidad DESC LIMIT ?`,
    desde, hasta, limite,
  );
}
