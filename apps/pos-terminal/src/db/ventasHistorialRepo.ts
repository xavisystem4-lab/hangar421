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

export interface VentaParaReabrir {
  nombreCliente: string | null;
  /** Líneas tal como se cobraron (precio y modificadores del momento), listas para el carrito. */
  items: {
    productoId: string;
    nombreProducto: string;
    cantidad: number;
    precioUnitario: number;
    notas?: string;
    categoria?: string;
    promocionId?: string;
    modificadores: { opcionModificadorId: string; nombreOpcion: string; precioExtra: number }[];
  }[];
}

/**
 * Lo necesario para "reabrir" una venta cobrada: sus líneas con producto, precio cobrado y
 * modificadores (con el id de la opción, no solo el nombre, para que el carrito las conserve) y
 * el nombre del pedido. La categoría se resuelve del catálogo actual: con ella el cobro vuelve a
 * reconocer una venta de DIDI. Reabrir = cancelar el ticket original y cobrar uno nuevo con lo
 * corregido (el ERP es append-only: nunca se edita una venta cobrada).
 */
export async function ventaParaReabrir(db: SQLiteDatabase, ventaId: string): Promise<VentaParaReabrir> {
  const venta = await db.getFirstAsync<any>("SELECT nombre_cliente FROM ventas WHERE id = ?", ventaId);
  const items = await db.getAllAsync<any>(
    `SELECT vi.id, vi.producto_id, vi.nombre_snapshot, vi.cantidad, vi.precio_unit_snapshot, vi.notas, vi.promocion_id,
            c.nombre AS categoria
     FROM venta_items vi
     LEFT JOIN productos p ON p.id = vi.producto_id
     LEFT JOIN categorias_producto c ON c.id = p.categoria_id
     WHERE vi.venta_id = ?`,
    ventaId,
  );
  const mods = items.length
    ? await db.getAllAsync<any>(
        `SELECT venta_item_id, opcion_modificador_id, nombre_snapshot, precio_extra_snapshot FROM venta_item_modificadores
         WHERE venta_item_id IN (${items.map(() => "?").join(",")})`,
        ...items.map((i) => i.id),
      )
    : [];
  return {
    nombreCliente: venta?.nombre_cliente ?? null,
    items: items.map((i) => ({
      productoId: i.producto_id,
      nombreProducto: i.nombre_snapshot,
      cantidad: i.cantidad,
      precioUnitario: i.precio_unit_snapshot,
      notas: i.notas ?? undefined,
      categoria: i.categoria ?? undefined,
      promocionId: i.promocion_id ?? undefined,
      modificadores: mods
        .filter((m) => m.venta_item_id === i.id)
        .map((m) => ({ opcionModificadorId: m.opcion_modificador_id, nombreOpcion: m.nombre_snapshot, precioExtra: m.precio_extra_snapshot ?? 0 })),
    })),
  };
}
