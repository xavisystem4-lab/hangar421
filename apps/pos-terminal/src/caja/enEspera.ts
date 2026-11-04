/** Pedidos en espera — lógica pura, sin imports de React ni SQLite, para poder probarla.
 *
 *  Caso real del mostrador: el cliente pidió, pero no hay cambio en ese momento o fue a su carro
 *  por dinero. En vez de cancelar el pedido (y volver a capturarlo) o tener la fila parada, el
 *  cajero lo aparta con su nombre, atiende al siguiente y lo retoma cuando el cliente regresa. */

export interface PedidoEnEspera<Item> {
  id: string;
  /** Nombre que se ve en la ficha: el del cliente, o "Espera 1", "Espera 2"… si no tiene. */
  etiqueta: string;
  nombreCliente: string | null;
  items: Item[];
  pedidoDidiId: string | null;
  /** ISO del momento en que se apartó: para saber cuánto lleva esperando. */
  desde: string;
}

/** Etiqueta para un pedido sin nombre: el primer "Espera N" que no esté usado. */
export function etiquetaLibre(existentes: { etiqueta: string }[]): string {
  const usadas = new Set(existentes.map((e) => e.etiqueta));
  let n = 1;
  while (usadas.has(`Espera ${n}`)) n += 1;
  return `Espera ${n}`;
}

/** Aparta el carrito actual. Un carrito vacío no se aparta (no hay nada que retomar). */
export function apartar<Item>(
  lista: PedidoEnEspera<Item>[],
  carrito: { items: Item[]; nombreCliente: string | null; pedidoDidiId: string | null },
  id: string,
  ahora: Date,
): PedidoEnEspera<Item>[] {
  if (carrito.items.length === 0) return lista;
  return [
    ...lista,
    {
      id,
      etiqueta: carrito.nombreCliente ?? etiquetaLibre(lista),
      nombreCliente: carrito.nombreCliente,
      items: carrito.items,
      pedidoDidiId: carrito.pedidoDidiId,
      desde: ahora.toISOString(),
    },
  ];
}

/** Saca de la lista el pedido a retomar. Si el carrito tenía algo, ese queda en espera en su
 *  lugar: retomar nunca tira lo que el cajero estaba capturando. */
export function retomar<Item>(
  lista: PedidoEnEspera<Item>[],
  id: string,
  carritoActual: { items: Item[]; nombreCliente: string | null; pedidoDidiId: string | null },
  idParaActual: string,
  ahora: Date,
): { lista: PedidoEnEspera<Item>[]; retomado: PedidoEnEspera<Item> | null } {
  const retomado = lista.find((p) => p.id === id) ?? null;
  if (!retomado) return { lista, retomado: null };
  const resto = lista.filter((p) => p.id !== id);
  return { lista: apartar(resto, carritoActual, idParaActual, ahora), retomado };
}

/** "3 min", "1 h 05 min": cuánto lleva esperando. */
export function tiempoEsperando(desde: string, ahora: Date): string {
  const min = Math.max(0, Math.floor((ahora.getTime() - new Date(desde).getTime()) / 60000));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;
}
