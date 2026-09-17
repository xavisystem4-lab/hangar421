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

/** Carrito/cuenta del modo "Punto de Venta" — store SEPARADO del `orderStore.ts` de Comandero
 *  (ese no se toca): acá el pedido se cobra desde la misma app (como en el POS Windows), no solo
 *  se manda a cocina, así que el carrito necesita `pedidoId`/`folio`/`descuentos` y un `cobrar()`
 *  que Comandero no tiene. Misma forma que `apps/pos-desktop/src/store/orderStore.ts`, sin la
 *  parte de impresión (ticket/comanda) — eso es exclusivo de Electron, ver el plan de Fase 2e. */

export interface ItemCarritoPos {
  id: string;
  productoId: string;
  nombreProducto: string;
  cantidad: number;
  precioUnitario: number;
  notas?: string;
  modificadores: { opcionModificadorId: string; nombreOpcion: string; precioExtra: number }[];
}

export interface DescuentoCarritoPos {
  tipo: TipoDescuento;
  valor: number;
  motivo: string;
  autorizadoPorId: string;
  /** Se valida server-side recién cuando el descuento se manda de verdad (enviarACocina) — solo
   *  vive en memoria, nunca se persiste en AsyncStorage. */
  password: string;
}

interface PagoCarrito {
  metodo: string;
  monto: number;
  referencia?: string;
}

interface PosOrderState {
  pedidoId: string | null;
  folio: string | null;
  mesaId: string | null;
  numComensales: number;
  items: ItemCarritoPos[];
  descuentos: DescuentoCarritoPos[];

  iniciar: (mesaId: string | null, numComensales?: number) => void;
  cargarPedidoExistente: (pedido: Pedido) => void;
  agregarItem: (item: Omit<ItemCarritoPos, "id">) => void;
  quitarItem: (itemId: string) => void;
  cambiarCantidad: (itemId: string, delta: number) => void;
  aplicarDescuento: (d: DescuentoCarritoPos) => void;
  limpiar: () => void;
  totales: () => ReturnType<typeof calcularTotalesPedido>;
  enviarACocina: () => Promise<string>;
  cobrar: (pagos: PagoCarrito[]) => Promise<void>;
  finalizarPagoExterno: () => Promise<void>;
}

export const usePosOrderStore = create<PosOrderState>((set, get) => ({
  pedidoId: null,
  folio: null,
  mesaId: null,
  numComensales: 1,
  items: [],
  descuentos: [],

  iniciar: (mesaId, numComensales = 1) => set({ pedidoId: null, folio: null, mesaId, numComensales, items: [], descuentos: [] }),

  /** Carga un pedido que ya existe en el servidor (ej. tomado desde "Comandero" en otro
   *  dispositivo, o desde Por Cobrar) para poder cobrarlo con la misma pantalla. */
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
          // Number(...): precioUnitario/precioExtra son Decimal de Prisma y llegan como STRING
          // por JSON — sin la conversión, totales() suma texto en vez de números (mismo bug
          // documentado en apps/pos-desktop/src/store/orderStore.ts).
          precioUnitario: Number(i.precioUnitario),
          notas: i.notas ?? undefined,
          modificadores: i.modificadores.map((m) => ({
            opcionModificadorId: m.opcionModificadorId,
            nombreOpcion: m.nombreOpcion ?? "",
            precioExtra: Number(m.precioExtra),
          })),
        })),
      descuentos: [],
    }),

  agregarItem: (item) => set((s) => ({ items: [...s.items, { ...item, id: uuid7() }] })),
  quitarItem: (itemId) => set((s) => ({ items: s.items.filter((i) => i.id !== itemId) })),
  cambiarCantidad: (itemId, delta) =>
    set((s) => ({
      items: s.items.map((i) => (i.id === itemId ? { ...i, cantidad: Math.max(1, i.cantidad + delta) } : i)).filter((i) => i.cantidad > 0),
    })),

  aplicarDescuento: (d) => set((s) => ({ descuentos: [...s.descuentos, d] })),

  limpiar: () => set({ pedidoId: null, folio: null, mesaId: null, numComensales: 1, items: [], descuentos: [] }),

  totales: () => {
    const { items, descuentos } = get();
    return calcularTotalesPedido(
      items.map((i) => ({ precioUnitario: i.precioUnitario, cantidad: i.cantidad, modificadoresPrecio: i.modificadores.reduce((s, m) => s + m.precioExtra, 0) })),
      descuentos,
      0.16,
    );
  },

  enviarACocina: async () => {
    const { items, mesaId, numComensales, descuentos } = get();
    const auth = useAuthStore.getState();
    if (items.length === 0) throw new Error("Agrega al menos un producto");

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
      canalOrigen: CanalOrigen.APP_POS_MOVIL,
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
      { id: pedidoId, entidad: "PEDIDO", operacion: "CREATE", entidadId: pedidoId, idempotencyKey, sucursalId: auth.sucursalId!, dispositivoId: auth.dispositivoId!, usuarioId: auth.usuario!.id, payload },
    );

    for (const d of descuentos) {
      const idk = `${auth.dispositivoId}-DESCUENTO-${uuid7()}`;
      await encolarSyncSiFalla(
        () => apiFetch(`/pedidos/${pedidoId}/descuentos`, { method: "POST", body: JSON.stringify(d) }),
        { id: uuid7(), entidad: "DESCUENTO", operacion: "CREATE", entidadId: pedidoId, idempotencyKey: idk, sucursalId: auth.sucursalId!, dispositivoId: auth.dispositivoId!, usuarioId: auth.usuario!.id, payload: { pedidoId, ...d } },
      );
    }

    set({ pedidoId, folio: pedidoCreado?.folio ?? null });
    return pedidoId;
  },

  cobrar: async (pagos) => {
    const { pedidoId } = get();
    if (!pedidoId) throw new Error("No hay un pedido enviado para cobrar");
    const auth = useAuthStore.getState();
    const idempotencyKey = `${auth.dispositivoId}-PAGO-${pedidoId}`;
    const payload = { pagos, cajeroId: auth.usuario!.id };

    await encolarSyncSiFalla(
      () => apiFetch(`/pedidos/${pedidoId}/cobrar`, { method: "POST", body: JSON.stringify(payload) }),
      { id: uuid7(), entidad: "PAGO", operacion: "CREATE", entidadId: pedidoId, idempotencyKey, sucursalId: auth.sucursalId!, dispositivoId: auth.dispositivoId!, usuarioId: auth.usuario!.id, payload },
    );

    get().limpiar();
  },

  /** Se llama cuando el backend ya confirmó APROBADO un pago con terminal (ver PosCobroScreen —
   *  socket "pago:actualizado"). El Pago y el estado COBRADO del pedido ya los registró el
   *  backend al procesar la solicitud; aquí solo queda limpiar el carrito local — sin impresión
   *  de ticket (exclusiva de Electron, ver orderStore.ts del POS Windows). */
  finalizarPagoExterno: async () => {
    get().limpiar();
  },
}));
