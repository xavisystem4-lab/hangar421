import { create } from "zustand";
import { CanalOrigen, TipoPedido, calcularTotalesPedido, uuid7 } from "@hangar421/shared";
import { apiFetch } from "../api/http";
import { useAuthStore } from "./authStore";
import { encolarSyncSiFalla } from "../sync/syncEngine";

export interface ItemCarrito {
  id: string;
  productoId: string;
  nombreProducto: string;
  cantidad: number;
  precioUnitario: number;
  notas?: string;
  modificadores: { opcionModificadorId: string; nombreOpcion: string; precioExtra: number }[];
}

interface OrderState {
  mesaId: string | null;
  numComensales: number;
  items: ItemCarrito[];
  iniciar: (mesaId: string | null, numComensales?: number) => void;
  agregarItem: (item: Omit<ItemCarrito, "id">) => void;
  quitarItem: (itemId: string) => void;
  cambiarCantidad: (itemId: string, delta: number) => void;
  totales: () => ReturnType<typeof calcularTotalesPedido>;
  enviarACocina: () => Promise<string>;
}

export const useOrderStore = create<OrderState>((set, get) => ({
  mesaId: null,
  numComensales: 2,
  items: [],

  iniciar: (mesaId, numComensales = 2) => set({ mesaId, numComensales, items: [] }),
  agregarItem: (item) => set((s) => ({ items: [...s.items, { ...item, id: uuid7() }] })),
  quitarItem: (itemId) => set((s) => ({ items: s.items.filter((i) => i.id !== itemId) })),
  cambiarCantidad: (itemId, delta) =>
    set((s) => ({
      items: s.items.map((i) => (i.id === itemId ? { ...i, cantidad: Math.max(1, i.cantidad + delta) } : i)).filter((i) => i.cantidad > 0),
    })),

  totales: () => {
    const { items } = get();
    return calcularTotalesPedido(
      items.map((i) => ({ precioUnitario: i.precioUnitario, cantidad: i.cantidad, modificadoresPrecio: i.modificadores.reduce((s, m) => s + m.precioExtra, 0) })),
      [],
      0.16,
    );
  },

  enviarACocina: async () => {
    const { items, mesaId, numComensales } = get();
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
      canalOrigen: CanalOrigen.APP_MESERO,
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
      { id: pedidoId, entidad: "PEDIDO", operacion: "CREATE", entidadId: pedidoId, idempotencyKey, sucursalId: auth.sucursalId!, dispositivoId: auth.dispositivoId!, usuarioId: auth.usuario!.id, payload },
    );

    set({ items: [], mesaId: null });
    return pedidoId;
  },
}));
