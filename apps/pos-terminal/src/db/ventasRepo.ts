import type { SQLiteDatabase } from "expo-sqlite";
import { uuid7, round2, validarPagoSuficiente, CanalOrigen, SyncEntidad, SyncOperacion, TipoPedido, type TotalesPedido } from "@hangar421/shared";
import { motivoDescuentoGeneral, motivoDescuentoProducto, totalesConDescuentos, type DescuentosVenta } from "../caja/descuentoVenta";
import { registrarConsumoMonedero, revertirConsumoMonedero } from "./monederoRepo";
import type { ItemCarrito } from "../store/carritoStore";
import type { CodigoOrigen } from "../caja/origenVenta";
import { normalizarNombreCliente, notasConNombreCliente } from "../caja/nombreCliente";
import { encolarSync } from "./outboxRepo";
import { obtenerOCrearDispositivoId, obtenerOCrearSucursalIdLocal, obtenerOCrearEmpresaIdLocal } from "./dispositivoLocal";

export interface PagoVenta {
  metodo: string;
  /** Lo que el pago CUBRE de la venta, en pesos — no lo que entregó el cliente. Es lo que
   *  suman el corte y los reportes por método (ver efectivoEsperadoPorMoneda). */
  monto: number;
  referencia?: string;
  /** Solo para el ticket ("paga con" y cambio); no viaja al ERP. */
  montoRecibido?: number;
  /** Solo EFECTIVO_USD: dólares entregados y pesos por dólar. */
  montoUsd?: number;
  tipoCambio?: number;
  /** Solo MONEDERO_EMPLEADO: la empleada (usuario) a cuyo monedero se carga. */
  empleadoId?: string;
}

/** Para ventas que no nacen en el carrito de mostrador (pedidos de DiDi/Uber/Rappi aceptados en
 *  Admin → Plataformas, ver plataformas/aceptarPedidoPlataforma.ts). Todo es opcional: sin
 *  opciones la venta es la de mostrador de siempre. */
export interface OpcionesVenta {
  /** Id ya acordado con el ERP: el Pedido del ERP se creó con este mismo id al aceptar el
   *  pedido de la plataforma, y así /sync/push lo reconoce en vez de crear otro. */
  ventaId?: string;
  canalOrigen?: CanalOrigen;
  /** 'DIDI' | 'UBER' | 'RAPPI': separa estas ventas en el corte y los reportes. Sin él, mostrador. */
  plataforma?: CodigoOrigen | null;
  tipo?: TipoPedido;
  notas?: string;
  /** Cortesía autorizada con PIN de supervisor (ver caja/cortesia.ts). Los totales que recibe
   *  confirmarVenta ya vienen con lo regalado como descuento; aquí se deja el registro. */
  cortesia?: { motivo: string; autorizadoPorId: string };
  /** Descuentos del cajero (general y/o por producto, sin PIN). Los totales de la venta SE
   *  RECALCULAN desde aquí con la misma función que el backend, así lo guardado, lo que se manda
   *  al ERP y lo que se cobra no pueden discrepar. No se combina con `cortesia`. */
  descuentos?: DescuentosVenta;
}

export interface VentaConfirmada {
  id: string;
  folioLocal: number;
  total: number;
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
  datos: {
    items: ItemCarrito[];
    pagos: PagoVenta[];
    totales: TotalesPedido;
    turnoId: string | null;
    usuarioId: string;
    /** Nombre del pedido para entregarlo (ticket + comanda). Opcional. */
    nombreCliente?: string | null;
  },
  opciones: OpcionesVenta = {},
): Promise<VentaConfirmada> {
  if (datos.items.length === 0) throw new Error("El carrito está vacío");
  if (opciones.descuentos && opciones.cortesia) throw new Error("Una venta no puede llevar descuento y cortesía a la vez");

  const calculoDescuentos = opciones.descuentos ? totalesConDescuentos(datos.items, opciones.descuentos) : null;
  const totales: TotalesPedido = calculoDescuentos
    ? { subtotal: calculoDescuentos.subtotal, descuentoTotal: calculoDescuentos.descuentoTotal, impuesto: 0, total: calculoDescuentos.total }
    : datos.totales;

  const { suficiente, faltante } = validarPagoSuficiente(datos.pagos, totales.total);
  if (!suficiente) throw new Error(`El total pagado no cubre el importe a pagar (faltan $${faltante.toFixed(2)})`);

  const nombreCliente = normalizarNombreCliente(datos.nombreCliente);
  const ventaId = opciones.ventaId ?? uuid7();
  const canalOrigen = opciones.canalOrigen ?? CanalOrigen.APP_POS_MOVIL;
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
         (id, sucursal_id, folio_local, mesa_id, cliente_id, estado, subtotal, descuento_monto, impuestos, total, canal_origen, turno_id, usuario_id, notas, created_at, updated_at, idempotency_key, nombre_cliente, plataforma)
       VALUES (?, ?, ?, NULL, NULL, 'COBRADA', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ventaId, sucursalId, folioLocal, totales.subtotal, totales.descuentoTotal, totales.impuesto, totales.total,
      canalOrigen, datos.turnoId, datos.usuarioId, opciones.notas ?? null, ahora, ahora, idempotencyKeyVenta, nombreCliente, opciones.plataforma ?? null,
    );

    const itemsPayload: {
      productoId: string;
      nombreProducto: string;
      precioUnitario: number;
      cantidad: number;
      notas?: string;
      /** Promoción con la que se vendió: el ERP recalcula el precio especial con su definición. */
      promocionId?: string;
      modificadores: { opcionModificadorId: string }[];
      descuento?: { tipo: string; valor: number; motivo: string };
    }[] = [];
    for (const [indice, item] of datos.items.entries()) {
      const itemId = uuid7();
      await db.runAsync(
        "INSERT INTO venta_items (id, venta_id, producto_id, nombre_snapshot, precio_unit_snapshot, cantidad, descuento_item, notas, promocion_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        itemId, ventaId, item.productoId, item.nombreProducto, item.precioUnitario, item.cantidad, calculoDescuentos?.porLinea[indice] ?? 0, item.notas ?? null, item.promocionId ?? null,
      );
      const descuentoLinea = opciones.descuentos?.porProducto[item.id];
      if (descuentoLinea && (calculoDescuentos?.porLinea[indice] ?? 0) > 0) {
        await db.runAsync(
          "INSERT INTO descuentos (id, venta_id, tipo, valor, motivo, autorizado_por_id, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)",
          uuid7(), ventaId, descuentoLinea.tipo, descuentoLinea.valor, motivoDescuentoProducto(item.nombreProducto, descuentoLinea), ahora,
        );
      }

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
        // Lo que se cobró por la línea (sin modificadores). El ERP solo lo usa si no tiene el
        // producto: lo registra con este nombre y precio en vez de rechazar la venta entera.
        nombreProducto: item.nombreProducto,
        precioUnitario: item.precioUnitario,
        cantidad: item.cantidad,
        notas: item.notas,
        ...(item.promocionId ? { promocionId: item.promocionId } : {}),
        // El backend resuelve precio y nombre por su cuenta desde OpcionModificador (ver
        // PedidosService.resolverItem), así que solo necesita el id — igual que manda el
        // Comandero.
        modificadores: (item.modificadores ?? []).map((m) => ({ opcionModificadorId: m.opcionModificadorId })),
        ...(descuentoLinea && (calculoDescuentos?.porLinea[indice] ?? 0) > 0
          ? { descuento: { tipo: descuentoLinea.tipo, valor: descuentoLinea.valor, motivo: motivoDescuentoProducto(item.nombreProducto, descuentoLinea) } }
          : {}),
      });
    }

    // Descuento general: una fila aparte. El ERP lo recalcula con sus precios sobre lo que queda
    // tras los descuentos por producto (calcularDescuentosVenta, el mismo orden que usa la tablet).
    const descuentoGeneral = opciones.descuentos?.general;
    if (descuentoGeneral && (calculoDescuentos?.descuentoGeneral ?? 0) > 0) {
      await db.runAsync(
        "INSERT INTO descuentos (id, venta_id, tipo, valor, motivo, autorizado_por_id, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)",
        uuid7(), ventaId, descuentoGeneral.tipo, descuentoGeneral.valor, motivoDescuentoGeneral(descuentoGeneral), ahora,
      );
    }

    if (opciones.cortesia && totales.descuentoTotal > 0) {
      await db.runAsync(
        "INSERT INTO descuentos (id, venta_id, tipo, valor, motivo, autorizado_por_id, created_at) VALUES (?, ?, 'MONTO', ?, ?, ?, ?)",
        uuid7(), ventaId, round2(totales.descuentoTotal), opciones.cortesia.motivo, opciones.cortesia.autorizadoPorId, ahora,
      );
    }

    const pagosPayload: PagoVenta[] = [];
    for (const pago of datos.pagos) {
      await db.runAsync(
        "INSERT INTO pagos (id, venta_id, metodo, monto, referencia, created_at, idempotency_key, monto_recibido, monto_usd, tipo_cambio, empleado_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        uuid7(), ventaId, pago.metodo, round2(pago.monto), pago.referencia ?? null, ahora, uuid7(),
        pago.montoRecibido != null ? round2(pago.montoRecibido) : null, pago.montoUsd ?? null, pago.tipoCambio ?? null, pago.empleadoId ?? null,
      );
      // Crédito de empleado: el consumo baja el saldo YA (dentro de la misma transacción), sin
      // esperar al ERP. Su id es el de la venta, el mismo con que el ERP lo registrará.
      if (pago.metodo === "MONEDERO_EMPLEADO") {
        if (!pago.empleadoId) throw new Error("El pago con crédito de empleado necesita la empleada");
        await registrarConsumoMonedero(db, { ventaId, usuarioId: pago.empleadoId, monto: round2(pago.monto), fecha: ahora });
      }
      pagosPayload.push({
        metodo: pago.metodo,
        monto: round2(pago.monto),
        referencia: pago.referencia,
        ...(pago.montoUsd != null ? { montoUsd: round2(pago.montoUsd), tipoCambio: pago.tipoCambio } : {}),
        ...(pago.empleadoId ? { empleadoId: pago.empleadoId } : {}),
      });
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
        tipo: opciones.tipo ?? TipoPedido.MOSTRADOR,
        numComensales: 1,
        meseroId: datos.usuarioId,
        canalOrigen,
        // El nombre del cliente viaja en las notas del pedido: así lo ve también el ERP/cocina.
        notasGenerales: notasConNombreCliente(nombreCliente, opciones.notas),
        // El ERP recalcula con sus precios; lo que se respeta es lo que pagó el cliente.
        cortesia: opciones.cortesia ? { totalACobrar: totales.total, motivo: opciones.cortesia.motivo } : undefined,
        descuentoGeneral: descuentoGeneral && (calculoDescuentos?.descuentoGeneral ?? 0) > 0
          ? { tipo: descuentoGeneral.tipo, valor: descuentoGeneral.valor, motivo: motivoDescuentoGeneral(descuentoGeneral) }
          : undefined,
        cortesiaAutorizadaPorId: opciones.cortesia?.autorizadoPorId,
        idempotencyKey: idempotencyKeyVenta,
        // El turno viaja con la venta: es lo que permite al ERP saber qué ventas pertenecen a
        // cada corte sin deducirlo por el cajero (ver CajaService.filtroVentasDelTurno).
        turnoId: datos.turnoId ?? undefined,
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

  return { id: ventaId, folioLocal, total: totales.total };
}

export interface DatosCancelacion {
  ventaId: string;
  motivo: string;
  solicitadaPorId: string;
  autorizadaPorId: string;
  autorizadaPorNombre: string;
}

/**
 * Cancela una venta de forma LÓGICA: cambia el estado y guarda quién, cuándo y por qué. No se
 * borra nada — el folio, los items y los pagos siguen ahí para auditar.
 *
 * Efecto en caja: el corte solo suma ventas 'COBRADA' (ver efectivoDelTurno y reportesRepo), así
 * que al cancelar baja solo el efectivo esperado, que es exactamente lo que ocurre en el cajón
 * al devolver el dinero. No hace falta un movimiento de caja aparte, y meterlo lo contaría dos
 * veces.
 *
 * Se encola como PEDIDO/UPDATE para que el ERP aplique la misma cancelación. Si la venta todavía
 * no había subido, sube ya cancelada — y si estaba en ERROR, la cancelación no la desbloquea:
 * son dos cosas distintas y se ven por separado en Admin → Sincronización.
 */
export async function cancelarVenta(db: SQLiteDatabase, datos: DatosCancelacion): Promise<void> {
  const venta = await db.getFirstAsync<any>("SELECT id, estado, folio_local FROM ventas WHERE id = ?", datos.ventaId);
  if (!venta) throw new Error("Venta no encontrada");
  if (venta.estado === "CANCELADA") return; // idempotente ante un doble toque

  const ahora = new Date().toISOString();
  const [sucursalId, dispositivoId] = await Promise.all([
    obtenerOCrearSucursalIdLocal(db),
    obtenerOCrearDispositivoId(db),
  ]);

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE ventas SET estado = 'CANCELADA', cancelada_at = ?, cancelada_motivo = ?,
         cancelada_solicitada_por = ?, cancelada_autorizada_por = ?, cancelada_autorizada_por_nombre = ?,
         updated_at = ?
       WHERE id = ?`,
      ahora, datos.motivo, datos.solicitadaPorId, datos.autorizadaPorId, datos.autorizadaPorNombre,
      ahora, datos.ventaId,
    );
    // Si se había pagado con crédito de empleado, el saldo vuelve a la empleada.
    await revertirConsumoMonedero(db, datos.ventaId);

    await encolarSync(db, {
      entidad: SyncEntidad.PEDIDO,
      operacion: SyncOperacion.UPDATE,
      entidadId: datos.ventaId,
      sucursalId,
      dispositivoId,
      usuarioId: datos.solicitadaPorId,
      payload: {
        accion: "CANCELAR",
        pedidoId: datos.ventaId,
        motivo: datos.motivo,
        // Quién autorizó viaja al ERP para el registro de auditoría. La validación del PIN ya
        // ocurrió en la terminal (ver auth/autorizacion.ts): tiene que funcionar sin red, que es
        // cuando más falta hace poder cancelar.
        autorizadoPorId: datos.autorizadaPorId,
        autorizadoPorNombre: datos.autorizadaPorNombre,
        solicitadoPorId: datos.solicitadaPorId,
        canceladaAtLocal: ahora,
      },
    });
  });
}
