import { create } from "zustand";
import { normalizarNombreCliente } from "../caja/nombreCliente";
import { apartar, retomar, type PedidoEnEspera } from "../caja/enEspera";
import { calcularTotalesPedido, uuid7, type TotalesPedido } from "@hangar421/shared";

export interface SeleccionModificador {
  opcionModificadorId: string;
  nombreOpcion: string;
  precioExtra: number;
}

export interface ItemCarrito {
  id: string;
  productoId: string;
  nombreProducto: string;
  cantidad: number;
  precioUnitario: number;
  notas?: string;
  /** Nombre de la categoría del producto ("DIDI", "Bebidas"…): con él se reconoce una venta del
   *  grupo DIDI al cobrar. */
  categoria?: string;
  /** Promoción (precio especial) aplicada al agregar el producto: `precioUnitario` ya es el precio
   *  con promoción y `precioLista` el de catálogo, para mostrar "antes $X". */
  promocionId?: string;
  nombrePromocion?: string;
  precioLista?: number;
  /** Lo elegido en el modal de personalización. Vacío en un producto sin modificadores. */
  modificadores: SeleccionModificador[];
}

interface CarritoState {
  items: ItemCarrito[];
  /** Nombre del pedido ("Ana"): sale en el ticket y en la comanda para saber a quién se le
   *  entrega. null = sin nombre. */
  nombreCliente: string | null;
  /** Ya se le preguntó al cajero por el nombre en ESTE pedido: no se vuelve a preguntar aunque
   *  haya dicho que no (se reinicia al limpiar el carrito). */
  nombrePreguntado: boolean;
  fijarNombreCliente: (nombre: string | null) => void;
  marcarNombrePreguntado: () => void;
  /** Pedido de DiDi (lista "en preparación") que se está cobrando con este carrito: al confirmar
   *  la venta se marca como cobrado. null = venta normal. */
  pedidoDidiId: string | null;
  /** Carga de golpe un pedido de DiDi ya confirmado: sus productos, su nombre y su id. */
  cargarPedidoDidi: (pedidoDidiId: string, nombre: string, items: Omit<ItemCarrito, "id">[]) => void;
  agregarItem: (item: Omit<ItemCarrito, "id">) => void;
  quitarItem: (itemId: string) => void;
  cambiarCantidad: (itemId: string, delta: number) => void;
  limpiar: () => void;
  /** Pedidos apartados (cliente sin cambio, fue a su carro…): cada uno es un botón en Venta. */
  enEspera: PedidoEnEspera<ItemCarrito>[];
  /** Aparta el carrito con un nombre o descripción ("Señor camioneta roja") y lo deja vacío
   *  para atender al siguiente. */
  ponerEnEspera: (descripcion: string | null) => void;
  /** Abre un pedido apartado con sus productos; lo que hubiera en el carrito queda en espera. */
  retomarEspera: (id: string) => void;
  descartarEspera: (id: string) => void;
  totales: () => TotalesPedido;
}

/** Carrito en memoria, previo a confirmar la venta (ver ventasRepo.confirmarVenta) — mostrador/
 *  contador, sin concepto de mesa (Decisión #4 del plan: mesas es opcional y llega después). */
export const useCarritoStore = create<CarritoState>((set, get) => ({
  items: [],
  nombreCliente: null,
  nombrePreguntado: false,
  pedidoDidiId: null,

  cargarPedidoDidi: (pedidoDidiId, nombre, items) =>
    set({
      pedidoDidiId,
      nombreCliente: normalizarNombreCliente(nombre),
      nombrePreguntado: true,
      items: items.map((i) => ({ ...i, modificadores: i.modificadores ?? [], id: uuid7() })),
    }),
  fijarNombreCliente: (nombre) => set({ nombreCliente: normalizarNombreCliente(nombre), nombrePreguntado: true }),
  marcarNombrePreguntado: () => set({ nombrePreguntado: true }),
  agregarItem: (item) => set((s) => ({ items: [...s.items, { ...item, modificadores: item.modificadores ?? [], id: uuid7() }] })),
  quitarItem: (itemId) => set((s) => ({ items: s.items.filter((i) => i.id !== itemId) })),
  cambiarCantidad: (itemId, delta) =>
    set((s) => ({
      items: s.items.map((i) => (i.id === itemId ? { ...i, cantidad: Math.max(1, i.cantidad + delta) } : i)).filter((i) => i.cantidad > 0),
    })),
  limpiar: () => set({ items: [], nombreCliente: null, nombrePreguntado: false, pedidoDidiId: null }),

  enEspera: [],
  ponerEnEspera: (descripcion) =>
    set((s) => {
      if (s.items.length === 0) return {};
      const nombre = normalizarNombreCliente(descripcion) ?? s.nombreCliente;
      return {
        enEspera: apartar(s.enEspera, { items: s.items, nombreCliente: nombre, pedidoDidiId: s.pedidoDidiId }, uuid7(), new Date()),
        items: [], nombreCliente: null, nombrePreguntado: false, pedidoDidiId: null,
      };
    }),
  retomarEspera: (id) =>
    set((s) => {
      const r = retomar(s.enEspera, id, { items: s.items, nombreCliente: s.nombreCliente, pedidoDidiId: s.pedidoDidiId }, uuid7(), new Date());
      if (!r.retomado) return {};
      return {
        enEspera: r.lista,
        items: r.retomado.items,
        nombreCliente: r.retomado.nombreCliente,
        // Ya tiene nombre (o se le puso descripción): no se vuelve a preguntar.
        nombrePreguntado: true,
        pedidoDidiId: r.retomado.pedidoDidiId,
      };
    }),
  descartarEspera: (id) => set((s) => ({ enEspera: s.enEspera.filter((p) => p.id !== id) })),

  totales: () => {
    const { items } = get();
    // `modificadoresPrecio` lo suma calcularSubtotal de @hangar421/shared por unidad, igual que
    // en el Comandero y en el POS Windows — la regla de dinero no se reimplementa aquí.
    return calcularTotalesPedido(
      items.map((i) => ({
        precioUnitario: i.precioUnitario,
        cantidad: i.cantidad,
        modificadoresPrecio: i.modificadores.reduce((s, m) => s + m.precioExtra, 0),
      })),
      [],
      0,
    );
  },
}));
