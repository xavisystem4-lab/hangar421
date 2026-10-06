import type { SQLiteDatabase } from "expo-sqlite";
import type { TicketPayload } from "../printing/PrinterAdapter";
import { obtenerDatosFiscales } from "./configFiscalRepo";
import { obtenerOCrearSucursalIdLocal } from "./dispositivoLocal";
import { ivaIncluido, propinaDeReferencia } from "../printing/formatoTicket";

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

  const pagos = await db.getAllAsync<any>(
    "SELECT metodo, monto, referencia, monto_recibido, monto_usd, tipo_cambio FROM pagos WHERE venta_id = ? ORDER BY created_at",
    ventaId,
  );
  const cortesia = await db.getFirstAsync<any>("SELECT id FROM descuentos WHERE venta_id = ? AND motivo LIKE 'Cortesía%' LIMIT 1", ventaId);
  // Lo que ENTREGÓ el cliente, en pesos, para "paga con" y el cambio. `monto` es lo que cubrió
  // (migración 12); los pagos viejos no tienen monto_recibido y su monto ya era lo entregado.
  const entregado = (p: any) =>
    p.metodo === "EFECTIVO_USD" && p.monto_usd != null && p.tipo_cambio != null
      ? Math.round(p.monto_usd * p.tipo_cambio * 100) / 100
      : p.monto_recibido ?? p.monto;
  const pagado = pagos.reduce((s, p) => s + entregado(p), 0);
  // La propina va anotada en el pago (PosCobroScreen); se suma a lo que debía pagar el cliente.
  const propina = Math.round(pagos.reduce((s, p) => s + propinaDeReferencia(p.referencia), 0) * 100) / 100;
  const debiaPagar = venta.total + propina;
  const etiquetaPago = (p: any): string => {
    if (p.metodo === "OTRO" && p.referencia) return p.referencia;
    if (p.metodo === "EFECTIVO_USD" && p.monto_usd != null) return `Dólares US$${Number(p.monto_usd).toFixed(2)} × $${Number(p.tipo_cambio).toFixed(2)}`;
    return p.metodo;
  };

  // Los precios ya incluyen impuestos (calculos.ts: `impuesto` siempre 0). Si algún día la venta
  // trae impuestos desglosados se imprimen esos; si no, la parte de IVA contenida en el total,
  // marcada como "incluido" — informativa, no cambia lo cobrado.
  const impuestosVenta = Number(venta.impuestos) || 0;
  const tasa = datosFiscales.tasaImpuesto;

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
    nombreSucursal: datosFiscales.nombreSucursalLocal || undefined,
    direccion: datosFiscales.direccion || undefined,
    descuento: Number(venta.descuento_monto) || 0,
    etiquetaDescuento: cortesia ? "Cortesía" : undefined,
    impuestos: impuestosVenta > 0 ? impuestosVenta : ivaIncluido(venta.total, tasa),
    etiquetaImpuestos: impuestosVenta > 0 ? "IVA" : `IVA ${Math.round(tasa * 100)}% incluido`,
    // Un pedido de plataforma se paga con metodo OTRO; su referencia ("DiDi #A123") es lo que
    // dice de verdad quién pagó, así que se imprime esa en vez de "Otro".
    // En dólares sale "Dólares US$20.00 × $18.50" con su equivalente en pesos.
    pagos: pagos.map((p) => ({ metodo: etiquetaPago(p), monto: entregado(p) })),
    propina: propina > 0 ? propina : undefined,
    cambio: pagado > debiaPagar ? Math.round((pagado - debiaPagar) * 100) / 100 : 0,
    anchoMM: datosFiscales.anchoImpresoraMM,
  };
}
