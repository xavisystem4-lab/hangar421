import type { SQLiteDatabase } from "expo-sqlite";
import type { ConsumoCredito } from "@hangar421/shared";

/**
 * Consumos con crédito de empleado cobrados EN ESTA TABLET en el rango (sale de la base local, así
 * que funciona sin conexión). El reporte completo de todas las tablets está en ERP → Reportes →
 * Crédito de empleados.
 */
export async function consumosCreditoLocales(db: SQLiteDatabase, desdeIso: string, hastaIso: string): Promise<ConsumoCredito[]> {
  const pagos = await db.getAllAsync<{
    venta_id: string; empleado_id: string | null; monto: number; folio_local: number | null; total: number; created_at: string; nombre: string | null;
  }>(
    `SELECT p.venta_id, p.empleado_id, SUM(p.monto) AS monto, v.folio_local, v.total, v.created_at,
            COALESCE(me.nombre, ul.nombre) AS nombre
       FROM pagos p
       JOIN ventas v ON v.id = p.venta_id
       LEFT JOIN monederos_empleado me ON me.usuario_id = p.empleado_id
       LEFT JOIN usuarios_locales ul ON ul.id = p.empleado_id
      WHERE p.metodo = 'MONEDERO_EMPLEADO' AND v.estado = 'COBRADA'
        AND v.created_at >= ? AND v.created_at <= ?
      GROUP BY p.venta_id, p.empleado_id
      ORDER BY v.created_at DESC`,
    desdeIso, hastaIso,
  );
  if (pagos.length === 0) return [];

  const ids = [...new Set(pagos.map((p) => p.venta_id))];
  const marcas = ids.map(() => "?").join(",");
  const items = await db.getAllAsync<{ id: string; venta_id: string; nombre_snapshot: string; cantidad: number; precio_unit_snapshot: number }>(
    `SELECT id, venta_id, nombre_snapshot, cantidad, precio_unit_snapshot FROM venta_items WHERE venta_id IN (${marcas}) ORDER BY rowid`,
    ...ids,
  );
  const idsItems = items.map((i) => i.id);
  const mods = idsItems.length
    ? await db.getAllAsync<{ venta_item_id: string; nombre_snapshot: string; precio_extra_snapshot: number }>(
        `SELECT venta_item_id, nombre_snapshot, precio_extra_snapshot FROM venta_item_modificadores WHERE venta_item_id IN (${idsItems.map(() => "?").join(",")})`,
        ...idsItems,
      )
    : [];

  return pagos.map((p) => ({
    empleadoId: p.empleado_id ?? "sin-empleada",
    empleado: p.nombre ?? "Empleada sin nombre",
    ventaId: p.venta_id,
    folio: p.folio_local != null ? String(p.folio_local) : null,
    fecha: p.created_at,
    sucursal: null,
    montoCredito: Math.round(Number(p.monto) * 100) / 100,
    totalVenta: Number(p.total),
    productos: items
      .filter((i) => i.venta_id === p.venta_id)
      .map((i) => ({
        nombre: i.nombre_snapshot,
        cantidad: Number(i.cantidad),
        precioUnitario: Number(i.precio_unit_snapshot),
        modificadores: mods.filter((m) => m.venta_item_id === i.id).map((m) => ({ nombre: m.nombre_snapshot, precioExtra: Number(m.precio_extra_snapshot) })),
      })),
  }));
}
