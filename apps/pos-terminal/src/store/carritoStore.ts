import { create } from "zustand";
import { calcularTotalesPedido, uuid7, type TotalesPedido } from "@hangar421/shared";

export interface ItemCarrito {
  id: string;
  productoId: string;
  nombreProducto: string;
  cantidad: number;
  precioUnitario: number;
  notas?: string;
}

interface CarritoState {
  items: ItemCarrito[];
  agregarItem: (item: Omit<ItemCarrito, "id">) => void;
  quitarItem: (itemId: string) => void;
  cambiarCantidad: (itemId: string, delta: number) => void;
  limpiar: () => void;
  totales: () => TotalesPedido;
}

/** Carrito en memoria, previo a confirmar la venta (ver ventasRepo.confirmarVenta) — mostrador/
 *  contador, sin concepto de mesa (Decisión #4 del plan: mesas es opcional y llega después). */
export const useCarritoStore = create<CarritoState>((set, get) => ({
  items: [],

  agregarItem: (item) => set((s) => ({ items: [...s.items, { ...item, id: uuid7() }] })),
  quitarItem: (itemId) => set((s) => ({ items: s.items.filter((i) => i.id !== itemId) })),
  cambiarCantidad: (itemId, delta) =>
    set((s) => ({
      items: s.items.map((i) => (i.id === itemId ? { ...i, cantidad: Math.max(1, i.cantidad + delta) } : i)).filter((i) => i.cantidad > 0),
    })),
  limpiar: () => set({ items: [] }),

  totales: () => {
    const { items } = get();
    return calcularTotalesPedido(
      items.map((i) => ({ precioUnitario: i.precioUnitario, cantidad: i.cantidad })),
      [],
      0,
    );
  },
}));
