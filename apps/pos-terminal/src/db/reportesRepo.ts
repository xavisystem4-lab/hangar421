import type { SQLiteDatabase } from "expo-sqlite";
import { obtenerOCrearSucursalIdLocal } from "./dispositivoLocal";

export interface ResumenVentas {
  totalVentas: number;
  cantidadVentas: number;
  ticketPromedio: number;
  totalPorMetodo: { metodo: string; total: number; cantidad: number }[];
  /** Mostrador y cada plataforma de delivery por separado (DiDi, Uber, Rappi), con su desglose por
   *  método de pago: lo que permite distinguir en el corte lo cobrado como DiDi. */
  totalPorOrigen: OrigenVentas[];
}

export interface OrigenVentas {
  /** 'MOSTRADOR' | 'DIDI' | 'UBER' | 'RAPPI' */
  origen: string;
  total: number;
  cantidad: number;
  porMetodo: { metodo: string; total: number; cantidad: number }[];
}

/** Desglose de ventas por origen y método de pago. Acepta cualquier condición ya armada sobre
 *  `ventas v` — la usan el corte del turno y los reportes con el mismo SQL. */
export async function ventasPorOrigen(db: SQLiteDatabase, whereSql: string, params: any[]): Promise<OrigenVentas[]> {
  const origenes = await db.getAllAsync<{ origen: string; total: number; cantidad: number }>(
    `SELECT COALESCE(v.plataforma, 'MOSTRADOR') as origen, COALESCE(SUM(v.total), 0) as total, COUNT(*) as cantidad
     FROM ventas v WHERE ${whereSql} GROUP BY COALESCE(v.plataforma, 'MOSTRADOR')`,
    ...params,
  );
  const metodos = await db.getAllAsync<{ origen: string; metodo: string; total: number; cantidad: number }>(
    `SELECT COALESCE(v.plataforma, 'MOSTRADOR') as origen, p.metodo as metodo, COALESCE(SUM(p.monto), 0) as total, COUNT(*) as cantidad
     FROM pagos p JOIN ventas v ON v.id = p.venta_id
     WHERE ${whereSql}
     GROUP BY COALESCE(v.plataforma, 'MOSTRADOR'), p.metodo ORDER BY total DESC`,
    ...params,
  );
  // Mostrador primero, luego las plataformas por importe.
  return origenes
    .map((o) => ({ ...o, porMetodo: metodos.filter((m) => m.origen === o.origen).map(({ metodo, total, cantidad }) => ({ metodo, total, cantidad })) }))
    .sort((a, b) => (a.origen === "MOSTRADOR" ? -1 : b.origen === "MOSTRADOR" ? 1 : b.total - a.total));
}

/** Corte del turno: lo cobrado en el turno separado por origen (mostrador / DiDi…) y método. */
export async function ventasPorOrigenDelTurno(db: SQLiteDatabase, turnoId: string): Promise<OrigenVentas[]> {
  return ventasPorOrigen(db, "v.turno_id = ? AND v.estado = 'COBRADA'", [turnoId]);
}

export interface DescuentoDelTurno {
  folio: number;
  tipo: string;
  valor: number;
  /** Texto guardado con el descuento: la descripción automática + la razón que escribió el cajero. */
  motivo: string;
}

/** Descuentos aplicados en las ventas cobradas del turno, para mostrarlos con su motivo en el
 *  corte. Las cortesías llevan su propio motivo y autorización, y también aparecen aquí. */
export async function descuentosDelTurno(db: SQLiteDatabase, turnoId: string): Promise<DescuentoDelTurno[]> {
  const filas = await db.getAllAsync<{ folio: number; tipo: string; valor: number; motivo: string | null }>(
    `SELECT v.folio_local as folio, d.tipo as tipo, d.valor as valor, d.motivo as motivo
     FROM descuentos d JOIN ventas v ON v.id = d.venta_id
     WHERE v.turno_id = ? AND v.estado = 'COBRADA'
     ORDER BY v.folio_local, d.created_at, d.id`,
    turnoId,
  );
  return filas.map((f) => ({ folio: f.folio, tipo: f.tipo, valor: f.valor, motivo: f.motivo?.trim() || "Descuento" }));
}

export interface ProductoVendido {
  nombre: string;
  cantidad: number;
  total: number;
}

export interface CajeroDelRango {
  usuarioId: string;
  nombre: string;
  ventas: number;
  total: number;
}

export interface VentaDetalle {
  id: string;
  folioLocal: number;
  createdAt: string;
  total: number;
  cajero: string;
  metodos: string;
  productos: string;
}

/** Filtros del reporte. `desde`/`hasta` son ISO completos (se comparan como texto contra
 *  `ventas.created_at`, que SQLite ordena correctamente). `usuarioId` vacío = todos los cajeros;
 *  `busqueda` vacía = sin filtrar por producto. */
export interface FiltroReporte {
  desde: string;
  hasta: string;
  usuarioId?: string | null;
  busqueda?: string;
}

/** Condición común a todos los reportes. Se construye una sola vez para que el resumen, el top
 *  de productos y el detalle exportado no puedan discrepar entre sí — que es justo lo que pasa
 *  cuando cada consulta arma su propio WHERE a mano. */
function condiciones(sucursalId: string, filtro: FiltroReporte): { sql: string; params: any[] } {
  const partes = ["v.sucursal_id = ?", "v.estado = 'COBRADA'", "v.created_at BETWEEN ? AND ?"];
  const params: any[] = [sucursalId, filtro.desde, filtro.hasta];

  if (filtro.usuarioId) {
    partes.push("v.usuario_id = ?");
    params.push(filtro.usuarioId);
  }

  // La búsqueda mira los productos de la venta, no la venta: "latte" tiene que encontrar los
  // tickets que llevan un latte, no los que se llamen así (una venta no tiene nombre).
  if (filtro.busqueda?.trim()) {
    partes.push("EXISTS (SELECT 1 FROM venta_items vi2 WHERE vi2.venta_id = v.id AND LOWER(vi2.nombre_snapshot) LIKE ?)");
    params.push(`%${filtro.busqueda.trim().toLowerCase()}%`);
  }

  return { sql: partes.join(" AND "), params };
}

/** Reportes 100% locales — agregaciones SQL puras sobre lo que ya vive en este dispositivo, sin
 *  depender del ERP. Todos acotados a la sucursal activa (migración 3): un corte que sumara las
 *  ventas de dos sucursales no cuadraría con el efectivo de ninguna de las dos cajas. */
export async function resumenVentas(db: SQLiteDatabase, filtro: FiltroReporte): Promise<ResumenVentas> {
  const sucursalId = await obtenerOCrearSucursalIdLocal(db);
  const { sql, params } = condiciones(sucursalId, filtro);

  const total = await db.getFirstAsync<{ total: number; cantidad: number }>(
    `SELECT COALESCE(SUM(v.total), 0) as total, COUNT(*) as cantidad FROM ventas v WHERE ${sql}`,
    ...params,
  );
  const porMetodo = await db.getAllAsync<{ metodo: string; total: number; cantidad: number }>(
    `SELECT p.metodo as metodo, COALESCE(SUM(p.monto), 0) as total, COUNT(*) as cantidad
     FROM pagos p JOIN ventas v ON v.id = p.venta_id
     WHERE ${sql}
     GROUP BY p.metodo ORDER BY total DESC`,
    ...params,
  );

  const cantidad = total?.cantidad ?? 0;
  const suma = total?.total ?? 0;
  return {
    totalVentas: suma,
    cantidadVentas: cantidad,
    ticketPromedio: cantidad > 0 ? Math.round((suma / cantidad) * 100) / 100 : 0,
    totalPorMetodo: porMetodo,
    totalPorOrigen: await ventasPorOrigen(db, sql, params),
  };
}

export async function topProductosVendidos(db: SQLiteDatabase, filtro: FiltroReporte, limite = 10): Promise<ProductoVendido[]> {
  const sucursalId = await obtenerOCrearSucursalIdLocal(db);
  const { sql, params } = condiciones(sucursalId, filtro);
  return db.getAllAsync<ProductoVendido>(
    `SELECT vi.nombre_snapshot as nombre, SUM(vi.cantidad) as cantidad, SUM(vi.precio_unit_snapshot * vi.cantidad) as total
     FROM venta_items vi JOIN ventas v ON v.id = vi.venta_id
     WHERE ${sql}
     GROUP BY vi.producto_id, vi.nombre_snapshot ORDER BY cantidad DESC LIMIT ?`,
    ...params, limite,
  );
}

/** Cajeros que vendieron en el rango — alimenta el selector de cajero. Solo salen los que
 *  realmente tienen ventas: un desplegable con toda la plantilla obliga a adivinar cuál trabajó
 *  ese día. Se hace LEFT JOIN porque un usuario borrado del dispositivo no debe hacer
 *  desaparecer sus ventas del reporte. */
export async function cajerosDelRango(db: SQLiteDatabase, desde: string, hasta: string): Promise<CajeroDelRango[]> {
  const sucursalId = await obtenerOCrearSucursalIdLocal(db);
  const filas = await db.getAllAsync<any>(
    `SELECT v.usuario_id as usuarioId, COALESCE(u.nombre, 'Usuario retirado') as nombre,
            COUNT(*) as ventas, COALESCE(SUM(v.total), 0) as total
     FROM ventas v LEFT JOIN usuarios_locales u ON u.id = v.usuario_id
     WHERE v.sucursal_id = ? AND v.estado = 'COBRADA' AND v.created_at BETWEEN ? AND ?
       AND v.usuario_id IS NOT NULL
     GROUP BY v.usuario_id, u.nombre ORDER BY total DESC`,
    sucursalId, desde, hasta,
  );
  return filas.map((f) => ({ usuarioId: f.usuarioId, nombre: f.nombre, ventas: f.ventas, total: f.total }));
}

/** Detalle venta a venta — lo que se exporta a Excel/PDF. Los productos y los métodos de pago se
 *  traen ya concatenados por SQL para no disparar dos consultas por ticket. */
export async function detalleVentas(db: SQLiteDatabase, filtro: FiltroReporte, limite = 2000): Promise<VentaDetalle[]> {
  const sucursalId = await obtenerOCrearSucursalIdLocal(db);
  const { sql, params } = condiciones(sucursalId, filtro);
  const filas = await db.getAllAsync<any>(
    `SELECT v.id, v.folio_local, v.created_at, v.total,
            COALESCE(u.nombre, '—') as cajero,
            (SELECT GROUP_CONCAT(p.metodo, ' + ') FROM pagos p WHERE p.venta_id = v.id) as metodos,
            (SELECT GROUP_CONCAT(vi.cantidad || 'x ' || vi.nombre_snapshot, ', ') FROM venta_items vi WHERE vi.venta_id = v.id) as productos
     FROM ventas v LEFT JOIN usuarios_locales u ON u.id = v.usuario_id
     WHERE ${sql}
     ORDER BY v.created_at DESC LIMIT ?`,
    ...params, limite,
  );
  return filas.map((f) => ({
    id: f.id,
    folioLocal: f.folio_local,
    createdAt: f.created_at,
    total: f.total,
    cajero: f.cajero,
    metodos: f.metodos ?? "—",
    productos: f.productos ?? "—",
  }));
}
