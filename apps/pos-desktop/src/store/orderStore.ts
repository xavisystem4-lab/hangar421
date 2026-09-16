import { create } from "zustand";
import {
  CanalOrigen,
  EstadoPedidoItem,
  TipoDescuento,
  TipoPedido,
  calcularTotalesPedido,
  uuid7,
  type Pedido,
} from "@hangar421/shared";
import { apiFetch } from "../api/http";
import { useAuthStore } from "./authStore";
import { encolarSyncSiFalla } from "../sync/syncEngine";
import { obtenerContextoTicket } from "../lib/ticketContexto";
import { imprimirComanda, imprimirTicketCliente } from "../lib/ticket";

export interface ItemCarrito {
  id: string; // local, temporal hasta confirmarse
  productoId: string;
  nombreProducto: string;
  cantidad: number;
  precioUnitario: number;
  notas?: string;
  modificadores: { opcionModificadorId: string; nombreOpcion: string; precioExtra: number }[];
}

export interface DescuentoCarrito {
  tipo: TipoDescuento;
  valor: number;
  motivo: string;
  autorizadoPorId: string;
  /** Contraseña de `autorizadoPorId` — el backend la valida server-side recién cuando este
   *  descuento se manda de verdad (ver enviarACocina abajo), no en el momento de aplicarlo aquí.
   *  Solo vive en memoria (este store no persiste a localStorage), nunca se guarda en disco. */
  password: string;
}

interface OrderState {
  pedidoId: string | null; // null hasta que se confirma/envía
  folio: string | null; // asignado por el backend al crear el pedido (null si se creó offline)
  mesaId: string | null;
  numComensales: number;
  items: ItemCarrito[];
  descuentos: DescuentoCarrito[];
  enviado: boolean;

  iniciar: (mesaId: string | null, numComensales?: number) => void;
  cargarPedidoExistente: (pedido: Pedido) => void;
  agregarItem: (item: Omit<ItemCarrito, "id">) => void;
  quitarItem: (itemId: string) => void;
  cambiarCantidad: (itemId: string, delta: number) => void;
  cambiarNotas: (itemId: string, notas: string) => void;
  aplicarDescuento: (d: DescuentoCarrito) => void;
  limpiar: () => void;
  totales: () => ReturnType<typeof calcularTotalesPedido>;
  enviarACocina: (mesaNombre?: string | null) => Promise<string>;
  cobrar: (pagos: { metodo: string; monto: number; referencia?: string }[], mesaNombre?: string | null) => Promise<void>;
  /** Cierra localmente una cuenta que YA fue liquidada por el backend (pago con tarjeta
   *  aprobado por el proveedor — ver PagosService.liquidarPedido()) — a diferencia de `cobrar()`,
   *  NUNCA llama a POST /pedidos/:id/cobrar (eso ya se hizo en el servidor al recibir la
   *  confirmación del proveedor; volver a llamarlo sería, en el mejor caso, redundante y en el
   *  peor, una fuente de bugs si algún día ese endpoint deja de ser idempotente). Solo imprime
   *  el ticket y limpia el carrito local. */
  finalizarPagoExterno: (mesaNombre?: string | null) => Promise<void>;
}

export const useOrderStore = create<OrderState>((set, get) => ({
  pedidoId: null,
  folio: null,
  mesaId: null,
  numComensales: 1,
  items: [],
  descuentos: [],
  enviado: false,

  iniciar: (mesaId, numComensales = 1) => set({ pedidoId: null, folio: null, mesaId, numComensales, items: [], descuentos: [], enviado: false }),

  /** Carga en el carrito un pedido que YA EXISTE en el servidor — típicamente uno enviado desde
   *  la app de Meseros — para poder cobrarlo con el mismo ModalCobro que usan los pedidos
   *  creados aquí mismo. Sin esto no había forma de ver ni cobrar esos pedidos desde el POS:
   *  Mesas.tsx solo abría un carrito en blanco (`iniciar`) sin importar si la mesa ya tenía un
   *  pedido enviado por una tablet. `descuentos` arranca vacío — cualquier descuento ya aplicado
   *  queda en el historial del pedido en el servidor; si el cajero quiere aplicar uno nuevo al
   *  cobrar, usa el mismo botón "% Descuento" de siempre (ModalCobro → aplicarDescuento). */
  cargarPedidoExistente: (pedido) =>
    set({
      pedidoId: pedido.id,
      folio: pedido.folio,
      mesaId: pedido.mesaId ?? null,
      numComensales: pedido.numComensales ?? 1,
      items: pedido.items
        .filter((i) => i.estado !== EstadoPedidoItem.CANCELADO)
        .map((i) => ({
          id: i.id,
          productoId: i.productoId,
          nombreProducto: i.nombreProducto ?? "",
          cantidad: i.cantidad,
          // Number(...): igual que p.total en PedidosPorCobrar.tsx, precioUnitario/precioExtra
          // son Decimal de Prisma en el backend y llegan como STRING por JSON pese al tipo
          // `number` de shared/entities.ts. Sin la conversión, ModalCobro hacía
          // `item.precioUnitario + ...` con un string — concatenación de texto en vez de suma,
          // y el total terminaba en NaN al multiplicar por cantidad — para cualquier pedido
          // cargado desde el backend (típicamente los que llegan de la app de Meseros).
          precioUnitario: Number(i.precioUnitario),
          notas: i.notas ?? undefined,
          modificadores: i.modificadores.map((m) => ({
            opcionModificadorId: m.opcionModificadorId,
            nombreOpcion: m.nombreOpcion ?? "",
            precioExtra: Number(m.precioExtra),
          })),
        })),
      descuentos: [],
      enviado: true,
    }),

  agregarItem: (item) => set((s) => ({ items: [...s.items, { ...item, id: uuid7() }] })),

  quitarItem: (itemId) => set((s) => ({ items: s.items.filter((i) => i.id !== itemId) })),

  cambiarCantidad: (itemId, delta) =>
    set((s) => ({
      items: s.items
        .map((i) => (i.id === itemId ? { ...i, cantidad: Math.max(1, i.cantidad + delta) } : i))
        .filter((i) => i.cantidad > 0),
    })),

  // Notas por producto ya en el carrito (ej. "sin hielo", "alergia a nuez") — antes solo se
  // podían capturar al agregar el producto desde ModalModificadores; esto permite agregarlas o
  // corregirlas después, sin tener que quitar el item y volver a agregarlo.
  cambiarNotas: (itemId, notas) =>
    set((s) => ({
      items: s.items.map((i) => (i.id === itemId ? { ...i, notas: notas.trim() || undefined } : i)),
    })),

  aplicarDescuento: (d) => set((s) => ({ descuentos: [...s.descuentos, d] })),

  limpiar: () => set({ pedidoId: null, folio: null, mesaId: null, numComensales: 1, items: [], descuentos: [], enviado: false }),

  totales: () => {
    const { items, descuentos } = get();
    // 0.16 de reserva si aún no hay tasa cargada; en producción viene de la sucursal activa (catalogStore/sucursal)
    const tasa = Number(localStorage.getItem("hangar421_tasa_impuesto") ?? "0.16");
    return calcularTotalesPedido(
      items.map((i) => ({
        precioUnitario: i.precioUnitario,
        cantidad: i.cantidad,
        modificadoresPrecio: i.modificadores.reduce((s, m) => s + m.precioExtra, 0),
      })),
      descuentos,
      tasa,
    );
  },

  /** Envía el pedido a cocina. Si hay conexión, se confirma de inmediato; si no, se encola
   *  en el outbox local (SQLite) y se sincroniza automáticamente al reconectar. Imprime la
   *  comanda (si hay impresora de cocina asignada, ver AdminTicket.tsx) independientemente de
   *  si hubo conexión — la cocina necesita el ticket en papel ahora mismo, no cuando sincronice. */
  enviarACocina: async (mesaNombre) => {
    const { items, mesaId, numComensales, descuentos } = get();
    const auth = useAuthStore.getState();
    if (items.length === 0) throw new Error("El pedido no tiene productos");

    const pedidoId = uuid7();
    const idempotencyKey = `${auth.dispositivoId}-PEDIDO-${pedidoId}`;
    const payload = {
      id: pedidoId,
      empresaId: auth.usuario!.empresaId,
      sucursalId: auth.sucursalId,
      mesaId: mesaId ?? undefined,
      tipo: mesaId ? TipoPedido.MESA : TipoPedido.MOSTRADOR,
      numComensales,
      meseroId: auth.usuario!.id,
      dispositivoId: auth.dispositivoId,
      canalOrigen: CanalOrigen.POS_WINDOWS,
      idempotencyKey,
      enviarInmediato: true,
      items: items.map((i) => ({
        productoId: i.productoId,
        cantidad: i.cantidad,
        notas: i.notas,
        modificadores: i.modificadores.map((m) => ({ opcionModificadorId: m.opcionModificadorId })),
      })),
    };

    const pedidoCreado = await encolarSyncSiFalla<any>(
      () => apiFetch("/pedidos", { method: "POST", body: JSON.stringify(payload) }),
      { id: pedidoId, entidad: "PEDIDO", operacion: "CREATE", entidadId: pedidoId, idempotencyKey, payload },
    );

    // aplicar descuentos capturados en el panel de pedido (si los hubo antes de enviar)
    for (const d of descuentos) {
      const idk = `${auth.dispositivoId}-DESCUENTO-${uuid7()}`;
      await encolarSyncSiFalla(
        () => apiFetch(`/pedidos/${pedidoId}/descuentos`, { method: "POST", body: JSON.stringify(d) }),
        { id: uuid7(), entidad: "DESCUENTO", operacion: "CREATE", entidadId: pedidoId, idempotencyKey: idk, payload: { pedidoId, ...d } },
      );
    }

    set({ pedidoId, folio: pedidoCreado?.folio ?? null, enviado: true });

    const { config } = await obtenerContextoTicket(auth.sucursalId!, auth.usuario!.empresaId);
    imprimirComanda(config, {
      mesaNombre,
      fecha: new Date(),
      items: items.map((i) => ({ cantidad: i.cantidad, nombre: i.nombreProducto, notas: i.notas })),
    }).catch((e) => console.error("[orderStore] error al imprimir comanda:", e));

    return pedidoId;
  },

  cobrar: async (pagos, mesaNombre) => {
    const { pedidoId, items, folio } = get();
    if (!pedidoId) throw new Error("No hay un pedido enviado para cobrar");
    const auth = useAuthStore.getState();
    const idempotencyKey = `${auth.dispositivoId}-PAGO-${pedidoId}`;
    const payload = { pedidoId, pagos, cajeroId: auth.usuario!.id };

    await encolarSyncSiFalla(
      () => apiFetch(`/pedidos/${pedidoId}/cobrar`, { method: "POST", body: JSON.stringify({ pagos, cajeroId: auth.usuario!.id }) }),
      { id: uuid7(), entidad: "PAGO", operacion: "CREATE", entidadId: pedidoId, idempotencyKey, payload },
    );

    const t = get().totales();
    const { config, empresaNombre, logoUrl, sucursalNombre } = await obtenerContextoTicket(auth.sucursalId!, auth.usuario!.empresaId);
    imprimirTicketCliente(config, {
      empresaNombre,
      sucursalNombre,
      logoUrl,
      mesaNombre,
      meseroNombre: auth.usuario!.nombre,
      folio: folio ?? pedidoId.slice(0, 8),
      fecha: new Date(),
      items: items.map((i) => ({
        cantidad: i.cantidad,
        nombre: i.nombreProducto,
        precioTotal: (i.precioUnitario + i.modificadores.reduce((s, m) => s + m.precioExtra, 0)) * i.cantidad,
      })),
      subtotal: t.subtotal,
      impuesto: t.impuesto,
      total: t.total,
    }).catch((e) => console.error("[orderStore] error al imprimir ticket:", e));

    get().limpiar();
  },

  finalizarPagoExterno: async (mesaNombre) => {
    const { pedidoId, items, folio } = get();
    if (!pedidoId) throw new Error("No hay un pedido enviado para cobrar");
    const auth = useAuthStore.getState();

    const t = get().totales();
    const { config, empresaNombre, logoUrl, sucursalNombre } = await obtenerContextoTicket(auth.sucursalId!, auth.usuario!.empresaId);
    imprimirTicketCliente(config, {
      empresaNombre,
      sucursalNombre,
      logoUrl,
      mesaNombre,
      meseroNombre: auth.usuario!.nombre,
      folio: folio ?? pedidoId.slice(0, 8),
      fecha: new Date(),
      items: items.map((i) => ({
        cantidad: i.cantidad,
        nombre: i.nombreProducto,
        precioTotal: (i.precioUnitario + i.modificadores.reduce((s, m) => s + m.precioExtra, 0)) * i.cantidad,
      })),
      subtotal: t.subtotal,
      impuesto: t.impuesto,
      total: t.total,
    }).catch((e) => console.error("[orderStore] error al imprimir ticket:", e));

    get().limpiar();
  },
}));
