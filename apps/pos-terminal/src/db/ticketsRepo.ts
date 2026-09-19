import type { SQLiteDatabase } from "expo-sqlite";
import type { TicketPayload } from "../printing/PrinterAdapter";
import { obtenerDatosFiscales } from "./configFiscalRepo";
import { obtenerOCrearSucursalIdLocal } from "./dispositivoLocal";

export async function marcarTicketPendiente(db: SQLiteDatabase, ventaId: string): Promise<void> {
  await db.runAsync("UPDATE ventas SET ticket_pendiente_impresion = 1 WHERE id = ?", ventaId);
}

export async function marcarTicketImpreso(db: SQLiteDatabase, ventaId: string): Promise<void> {
  await db.runAsync("UPDATE ventas SET ticket_pendiente_impresion = 0 WHERE id = ?", ventaId);
}

export interface VentaPendienteTicket { id: string; folioLocal: number; total: number; createdAt: string }

/** Acotado a la sucursal activa (migración 3) — un ticket pendiente de otra sucursal se
 *  imprimiría con los datos fiscales de esta, que son los de la sucursal actual. */
export async function listarTicketsPendientes(db: SQLiteDatabase): Promise<VentaPendienteTicket[]> {
  const sucursalId = await obtenerOCrearSucursalIdLocal(db);
  const filas = await db.getAllAsync<any>(
    "SELECT id, folio_local, total, created_at FROM ventas WHERE sucursal_id = ? AND ticket_pendiente_impresion = 1 ORDER BY created_at DESC",
    sucursalId,
  );
  return filas.map((f) => ({ id: f.id, folioLocal: f.folio_local, total: f.total, createdAt: f.created_at }));
}

export async function construirTicketPayload(db: SQLiteDatabase, ventaId: string): Promise<TicketPayload> {
  const venta = await db.getFirstAsync<any>("SELECT * FROM ventas WHERE id = ?", ventaId);
  if (!venta) throw new Error("Venta no encontrada");
  const items = await db.getAllAsync<any>("SELECT nombre_snapshot, precio_unit_snapshot, cantidad FROM venta_items WHERE venta_id = ?", ventaId);
  const datosFiscales = await obtenerDatosFiscales(db);

  return {
    folio: venta.folio_local,
    fecha: venta.created_at,
    items: items.map((i) => ({ cantidad: i.cantidad, nombre: i.nombre_snapshot, precioTotal: i.precio_unit_snapshot * i.cantidad })),
    subtotal: venta.subtotal,
    total: venta.total,
    pieTicket: datosFiscales.pieTicket,
    razonSocial: datosFiscales.razonSocial || undefined,
    rfc: datosFiscales.rfc || undefined,
  };
}
