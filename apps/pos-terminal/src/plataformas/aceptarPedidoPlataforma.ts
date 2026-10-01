import type { SQLiteDatabase } from "expo-sqlite";
import { uuid7 } from "@hangar421/shared";
import { confirmarVenta, type VentaConfirmada } from "../db/ventasRepo";
import { turnoAbierto } from "../db/turnosRepo";
import { obtenerOCrearDispositivoId, obtenerOCrearSucursalIdLocal } from "../db/dispositivoLocal";
import { imprimirTicket } from "../printing/imprimirTicket";
import { sincronizarPronto } from "../sync/syncEngine";
import { plataformasApi } from "./plataformasApi";
import { ventaDesdePedidoErp, type MapeoItem, type PedidoEntrante } from "./ventaPlataforma";

/**
 * Acepta un pedido de DiDi/Uber/Rappi y lo registra como venta de esta terminal.
 *
 * 1. Exige turno de caja abierto ANTES de tocar el ERP: aceptar sin poder registrar la venta
 *    dejaría el pedido fuera del corte.
 * 2. Genera aquí el id (uuid7) y se lo pasa al ERP, que crea el Pedido (DOMICILIO, canal
 *    PLATAFORMA_DELIVERY) con ese mismo id y lo manda a cocina.
 * 3. Con el pedido que devuelve el ERP (sus precios y totales) registra la venta local con ese
 *    id, pagada con método OTRO y la plataforma como referencia. Cuando la venta sube por
 *    /sync/push, el ERP reconoce el id: no crea otro pedido, solo le aplica el cobro.
 * 4. Intenta imprimir el ticket (best-effort, como cualquier venta).
 *
 * Reintentar tras un fallo de red es seguro: el ERP es idempotente por orden aceptada.
 */
export async function aceptarPedidoPlataforma(
  db: SQLiteDatabase,
  pedido: PedidoEntrante,
  mapeo: MapeoItem[],
  usuarioId: string,
  nombresLocales: Record<string, string>,
): Promise<VentaConfirmada> {
  const turno = await turnoAbierto(db);
  if (!turno) throw new Error("No hay un turno de caja abierto — abre caja antes de aceptar pedidos de plataforma.");

  const [sucursalId, dispositivoId] = await Promise.all([obtenerOCrearSucursalIdLocal(db), obtenerOCrearDispositivoId(db)]);
  const pedidoId = uuid7();

  const pedidoErp = await plataformasApi.aceptarPedido(pedido.id, {
    sucursalId,
    items: mapeo,
    pedidoId,
    turnoId: turno.id,
    meseroId: usuarioId,
    dispositivoId,
  });

  // Si el ERP ya tenía aceptada esta orden (reintento tras un corte de red), devuelve el pedido
  // de la primera vez, con SU id. Si esa venta ya quedó registrada aquí, no se registra otra.
  const yaRegistrada = await db.getFirstAsync<{ id: string; folio_local: number; total: number }>(
    "SELECT id, folio_local, total FROM ventas WHERE id = ?",
    pedidoErp.id,
  );
  if (yaRegistrada) return { id: yaRegistrada.id, folioLocal: yaRegistrada.folio_local, total: yaRegistrada.total };

  const venta = ventaDesdePedidoErp(pedidoErp, pedido, nombresLocales);
  const confirmada = await confirmarVenta(
    db,
    { items: venta.items, pagos: venta.pagos, totales: venta.totales, turnoId: turno.id, usuarioId },
    venta.opciones,
  );

  sincronizarPronto();
  await imprimirTicket(db, confirmada.id);
  return confirmada;
}
