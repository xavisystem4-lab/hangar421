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
  const items = await db.getAllAsync<any>("SELECT id, nombre_snapshot, precio_unit_snapshot, cantidad FROM venta_items WHERE venta_id = ?", ventaId);
  const datosFiscales = await obtenerDatosFiscales(db);

  // Los modificadores elegidos en cada línea. Se leen de los snapshots, no del catálogo vigente:
  // reimprimir un ticket de hace meses debe mostrar lo que se cobró entonces.
  const modificadores = items.length
    ? await db.getAllAsync<any>(
        `SELECT venta_item_id, nombre_snapshot, precio_extra_snapshot FROM venta_item_modificadores
         WHERE venta_item_id IN (${items.map(() => "?").join(",")})`,
        ...items.map((i) => i.id),
      )
    : [];

  return {
    folio: venta.folio_local,
    fecha: venta.created_at,
    items: items.map((i) => {
      const suyos = modificadores.filter((m) => m.venta_item_id === i.id);
      const extra = suyos.reduce((s, m) => s + m.precio_extra_snapshot, 0);
      return {
        cantidad: i.cantidad,
        nombre: i.nombre_snapshot,
        // El precio de la línea incluye los extras, o el ticket no sumaría el total cobrado.
        precioTotal: (i.precio_unit_snapshot + extra) * i.cantidad,
        modificadores: suyos.length > 0 ? suyos.map((m) => m.nombre_snapshot) : undefined,
      };
    }),
    subtotal: venta.subtotal,
    total: venta.total,
    pieTicket: datosFiscales.pieTicket,
    razonSocial: datosFiscales.razonSocial || undefined,
    rfc: datosFiscales.rfc || undefined,
  };
}
