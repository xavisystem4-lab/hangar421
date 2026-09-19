import type { SQLiteDatabase } from "expo-sqlite";
import { uuid7, round2, validarPagoSuficiente, CanalOrigen, SyncEntidad, SyncOperacion, TipoPedido, type TotalesPedido } from "@hangar421/shared";
import type { ItemCarrito } from "../store/carritoStore";
import { encolarSync } from "./outboxRepo";
import { obtenerOCrearDispositivoId, obtenerOCrearSucursalIdLocal } from "./dispositivoLocal";
import { obtenerConfig, guardarConfig } from "./configLocalRepo";

export interface PagoVenta {
  metodo: string;
  monto: number;
  referencia?: string;
}

export interface VentaConfirmada {
  id: string;
  folioLocal: number;
  total: number;
}

const CLAVE_EMPRESA_PLACEHOLDER = "empresa_id_local";

async function obtenerOCrearEmpresaIdLocal(db: SQLiteDatabase): Promise<string> {
  const existente = await obtenerConfig(db, CLAVE_EMPRESA_PLACEHOLDER);
  if (existente) return existente;
  const id = uuid7();
  await guardarConfig(db, CLAVE_EMPRESA_PLACEHOLDER, id);
  return id;
}

/** El corazón de la venta offline: UNA transacción cubre la venta + sus items + sus pagos + los
 *  dos eventos de sync (PEDIDO/CREATE, PAGO) — todo o nada, nunca una venta a medias. `id`/
 *  `idempotencyKey` se generan con uuid7() ANTES de abrir la transacción, así que aunque la
 *  llamada se reintentara completa después de un fallo, la restricción UNIQUE de
 *  `ventas.idempotency_key` evita duplicarla (no debería pasar nunca en la práctica, ya que la
 *  transacción de SQLite es atómica de por sí, pero es la misma defensa en profundidad que ya
 *  usa el outbox contra reintentos de /sync/push, ver sync.service.ts del backend). */
export async function confirmarVenta(
  db: SQLiteDatabase,
  datos: { items: ItemCarrito[]; pagos: PagoVenta[]; totales: TotalesPedido; turnoId: string | null; usuarioId: string },
): Promise<VentaConfirmada> {
  if (datos.items.length === 0) throw new Error("El carrito está vacío");

  const { suficiente, faltante } = validarPagoSuficiente(datos.pagos, datos.totales.total);
  if (!suficiente) throw new Error(`El total pagado no cubre el importe a pagar (faltan $${faltante.toFixed(2)})`);

  const ventaId = uuid7();
  const idempotencyKeyVenta = uuid7();
  const ahora = new Date().toISOString();
  const [sucursalId, dispositivoId, empresaId] = await Promise.all([
    obtenerOCrearSucursalIdLocal(db),
    obtenerOCrearDispositivoId(db),
    obtenerOCrearEmpresaIdLocal(db),
  ]);

  let folioLocal = 0;

  await db.withTransactionAsync(async () => {
    // Consecutivo POR SUCURSAL (migración 3): cada sucursal numera sus tickets desde 1, sin
    // heredar los folios de otra en la que este mismo dispositivo haya operado antes.
    const { siguiente } = (await db.getFirstAsync<{ siguiente: number }>(
      "SELECT COALESCE(MAX(folio_local), 0) + 1 AS siguiente FROM ventas WHERE sucursal_id = ?",
      sucursalId,
    )) ?? { siguiente: 1 };
    folioLocal = siguiente;

    await db.runAsync(
      `INSERT INTO ventas
         (id, sucursal_id, folio_local, mesa_id, cliente_id, estado, subtotal, descuento_monto, impuestos, total, canal_origen, turno_id, usuario_id, created_at, updated_at, idempotency_key)
       VALUES (?, ?, ?, NULL, NULL, 'COBRADA', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ventaId, sucursalId, folioLocal, datos.totales.subtotal, datos.totales.descuentoTotal, datos.totales.impuesto, datos.totales.total,
      CanalOrigen.APP_POS_MOVIL, datos.turnoId, datos.usuarioId, ahora, ahora, idempotencyKeyVenta,
    );

    const itemsPayload: { productoId: string; cantidad: number; notas?: string; modificadores: { opcionModificadorId: string }[] }[] = [];
    for (const item of datos.items) {
      const itemId = uuid7();
      await db.runAsync(
        "INSERT INTO venta_items (id, venta_id, producto_id, nombre_snapshot, precio_unit_snapshot, cantidad, descuento_item, notas) VALUES (?, ?, ?, ?, ?, ?, 0, ?)",
        itemId, ventaId, item.productoId, item.nombreProducto, item.precioUnitario, item.cantidad, item.notas ?? null,
      );

      // Snapshot del nombre y del precio extra, no solo el id: el ticket y el historial deben
      // seguir leyéndose aunque el modificador se renombre o desaparezca del catálogo.
      for (const modificador of item.modificadores ?? []) {
        await db.runAsync(
          "INSERT INTO venta_item_modificadores (id, venta_item_id, opcion_modificador_id, nombre_snapshot, precio_extra_snapshot) VALUES (?, ?, ?, ?, ?)",
          uuid7(), itemId, modificador.opcionModificadorId, modificador.nombreOpcion, round2(modificador.precioExtra),
        );
      }

      itemsPayload.push({
        productoId: item.productoId,
        cantidad: item.cantidad,
        notas: item.notas,
        // El backend resuelve precio y nombre por su cuenta desde OpcionModificador (ver
        // PedidosService.resolverItem), así que solo necesita el id — igual que manda el
        // Comandero.
        modificadores: (item.modificadores ?? []).map((m) => ({ opcionModificadorId: m.opcionModificadorId })),
      });
    }

    const pagosPayload: PagoVenta[] = [];
    for (const pago of datos.pagos) {
      await db.runAsync(
        "INSERT INTO pagos (id, venta_id, metodo, monto, referencia, created_at, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?)",
        uuid7(), ventaId, pago.metodo, round2(pago.monto), pago.referencia ?? null, ahora, uuid7(),
      );
      pagosPayload.push({ metodo: pago.metodo, monto: round2(pago.monto), referencia: pago.referencia });
    }

    // Orden PEDIDO→PAGO: sync_outbox se drena por orden_secuencia (Fase 2a) — el pago necesita
    // que el pedido ya exista server-side, y encolarSync() reserva el siguiente correlativo en
    // el orden en que se llama, así que basta con llamarlo en este orden.
    await encolarSync(db, {
      entidad: SyncEntidad.PEDIDO,
      operacion: SyncOperacion.CREATE,
      entidadId: ventaId,
      sucursalId,
      dispositivoId,
      usuarioId: datos.usuarioId,
      payload: {
        empresaId,
        mesaId: undefined,
        clienteId: undefined,
        tipo: TipoPedido.MOSTRADOR,
        numComensales: 1,
        meseroId: datos.usuarioId,
        canalOrigen: CanalOrigen.APP_POS_MOVIL,
        idempotencyKey: idempotencyKeyVenta,
        items: itemsPayload,
        enviarInmediato: true,
      },
    });

    await encolarSync(db, {
      entidad: SyncEntidad.PAGO,
      operacion: SyncOperacion.CREATE,
      entidadId: ventaId,
      sucursalId,
      dispositivoId,
      usuarioId: datos.usuarioId,
      payload: { pedidoId: ventaId, pagos: pagosPayload, cajeroId: datos.usuarioId },
    });
  });

  return { id: ventaId, folioLocal, total: datos.totales.total };
}
