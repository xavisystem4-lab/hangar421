import { create } from "zustand";
import {
  CanalOrigen,
  TipoDescuento,
  TipoPedido,
  calcularTotalesPedido,
  uuid7,
} from "@hangar421/shared";
import { apiFetch } from "../api/http";
import { useAuthStore } from "./authStore";
import { encolarSyncSiFalla } from "../sync/syncEngine";

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
}

interface OrderState {
  pedidoId: string | null; // null hasta que se confirma/envía
  mesaId: string | null;
  numComensales: number;
  items: ItemCarrito[];
  descuentos: DescuentoCarrito[];
  enviado: boolean;

  iniciar: (mesaId: string | null, numComensales?: number) => void;
  agregarItem: (item: Omit<ItemCarrito, "id">) => void;
  quitarItem: (itemId: string) => void;
  cambiarCantidad: (itemId: string, delta: number) => void;
  cambiarNotas: (itemId: string, notas: string) => void;
  aplicarDescuento: (d: DescuentoCarrito) => void;
  limpiar: () => void;
  totales: () => ReturnType<typeof calcularTotalesPedido>;
  enviarACocina: () => Promise<string>;
  cobrar: (pagos: { metodo: string; monto: number; referencia?: string }[]) => Promise<void>;
}

export const useOrderStore = create<OrderState>((set, get) => ({
  pedidoId: null,
  mesaId: null,
  numComensales: 1,
  items: [],
  descuentos: [],
  enviado: false,

  iniciar: (mesaId, numComensales = 1) => set({ pedidoId: null, mesaId, numComensales, items: [], descuentos: [], enviado: false }),

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

  limpiar: () => set({ pedidoId: null, mesaId: null, numComensales: 1, items: [], descuentos: [], enviado: false }),

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
   *  en el outbox local (SQLite) y se sincroniza automáticamente al reconectar. */
  enviarACocina: async () => {
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

    await encolarSyncSiFalla(
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

    set({ pedidoId, enviado: true });
    return pedidoId;
  },

  cobrar: async (pagos) => {
    const { pedidoId } = get();
    if (!pedidoId) throw new Error("No hay un pedido enviado para cobrar");
    const auth = useAuthStore.getState();
    const idempotencyKey = `${auth.dispositivoId}-PAGO-${pedidoId}`;
    const payload = { pedidoId, pagos, cajeroId: auth.usuario!.id };

    await encolarSyncSiFalla(
      () => apiFetch(`/pedidos/${pedidoId}/cobrar`, { method: "POST", body: JSON.stringify({ pagos, cajeroId: auth.usuario!.id }) }),
      { id: uuid7(), entidad: "PAGO", operacion: "CREATE", entidadId: pedidoId, idempotencyKey, payload },
    );

    get().limpiar();
  },
}));
