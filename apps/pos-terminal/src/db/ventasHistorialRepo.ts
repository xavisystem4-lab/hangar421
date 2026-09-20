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

export interface VentaConsulta {
  id: string;
  folioLocal: number;
  createdAt: string;
  total: number;
  estado: string;
  cajero: string;
  articulos: number;
  metodos: string;
  /** Estado de sincronización derivado del outbox: qué sabe el ERP de esta venta. */
  sync: "SINCRONIZADA" | "PENDIENTE" | "ERROR";
  canceladaMotivo: string | null;
  canceladaPorNombre: string | null;
  canceladaAt: string | null;
}

export interface FiltroConsulta {
  desde?: string;
  hasta?: string;
  usuarioId?: string | null;
  estado?: string | null;
  folio?: string;
}

/**
 * Tickets de la sucursal activa, con su estado de sincronización.
 *
 * El estado de sync sale del outbox y no de la venta: la venta no sabe si llegó al ERP. Se
 * resuelve con dos subconsultas en vez de un JOIN para no multiplicar filas cuando una venta
 * tiene varios eventos encolados (el PEDIDO y su PAGO van por separado).
 */
export async function consultarVentas(db: SQLiteDatabase, filtro: FiltroConsulta, limite = 200): Promise<VentaConsulta[]> {
  const sucursalId = await obtenerOCrearSucursalIdLocal(db);
  const partes = ["v.sucursal_id = ?"];
  const params: any[] = [sucursalId];

  if (filtro.desde && filtro.hasta) {
    partes.push("v.created_at BETWEEN ? AND ?");
    params.push(filtro.desde, filtro.hasta);
  }
  if (filtro.usuarioId) {
    partes.push("v.usuario_id = ?");
    params.push(filtro.usuarioId);
  }
  if (filtro.estado) {
    partes.push("v.estado = ?");
    params.push(filtro.estado);
  }
  if (filtro.folio?.trim()) {
    partes.push("CAST(v.folio_local AS TEXT) LIKE ?");
    params.push(`%${filtro.folio.trim()}%`);
  }

  const filas = await db.getAllAsync<any>(
    `SELECT v.id, v.folio_local, v.created_at, v.total, v.estado,
            v.cancelada_motivo, v.cancelada_autorizada_por_nombre, v.cancelada_at,
            COALESCE(u.nombre, '—') AS cajero,
            (SELECT COALESCE(SUM(vi.cantidad), 0) FROM venta_items vi WHERE vi.venta_id = v.id) AS articulos,
            (SELECT GROUP_CONCAT(DISTINCT p.metodo) FROM pagos p WHERE p.venta_id = v.id) AS metodos,
            (SELECT COUNT(*) FROM sync_outbox o WHERE o.entidad_id = v.id AND o.estado = 'ERROR') AS con_error,
            (SELECT COUNT(*) FROM sync_outbox o WHERE o.entidad_id = v.id AND o.estado IN ('PENDING','SYNCING')) AS en_cola
     FROM ventas v LEFT JOIN usuarios_locales u ON u.id = v.usuario_id
     WHERE ${partes.join(" AND ")}
     ORDER BY v.created_at DESC LIMIT ?`,
    ...params, limite,
  );

  return filas.map((f) => ({
    id: f.id,
    folioLocal: f.folio_local,
    createdAt: f.created_at,
    total: f.total,
    estado: f.estado,
    cajero: f.cajero,
    articulos: f.articulos,
    metodos: f.metodos ?? "—",
    // El error manda sobre la cola: una venta con un evento fallido necesita atención aunque
    // tenga otros pendientes.
    sync: f.con_error > 0 ? "ERROR" : f.en_cola > 0 ? "PENDIENTE" : "SINCRONIZADA",
    canceladaMotivo: f.cancelada_motivo ?? null,
    canceladaPorNombre: f.cancelada_autorizada_por_nombre ?? null,
    canceladaAt: f.cancelada_at ?? null,
  }));
}

export interface LineaTicket {
  nombre: string;
  cantidad: number;
  precioUnitario: number;
  modificadores: string[];
  notas: string | null;
}

/** Detalle completo de un ticket, con los modificadores elegidos — se lee de los snapshots, así
 *  que un ticket de hace meses muestra lo que se cobró entonces. */
export async function detalleTicket(db: SQLiteDatabase, ventaId: string): Promise<LineaTicket[]> {
  const items = await db.getAllAsync<any>(
    "SELECT id, nombre_snapshot, cantidad, precio_unit_snapshot, notas FROM venta_items WHERE venta_id = ?",
    ventaId,
  );
  if (items.length === 0) return [];

  const mods = await db.getAllAsync<any>(
    `SELECT venta_item_id, nombre_snapshot FROM venta_item_modificadores
     WHERE venta_item_id IN (${items.map(() => "?").join(",")})`,
    ...items.map((i) => i.id),
  );

  return items.map((i) => ({
    nombre: i.nombre_snapshot,
    cantidad: i.cantidad,
    precioUnitario: i.precio_unit_snapshot,
    modificadores: mods.filter((m) => m.venta_item_id === i.id).map((m) => m.nombre_snapshot),
    notas: i.notas ?? null,
  }));
}
