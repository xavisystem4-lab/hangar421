/**
 * Nombre que se le pone a un pedido para identificar a quién se le entrega ("Ana", "Mesa 3",
 * "Sr. Pérez"). Va en el ticket, en la comanda de preparación y en las notas del pedido del ERP.
 * Funciones puras, sin I/O, para poder probarlas con Jest.
 */

export const MAX_NOMBRE_CLIENTE = 24;

/** Limpia lo que tecleó el cajero: sin saltos ni caracteres de control (romperían el ticket),
 *  espacios colapsados y un tope de largo. Devuelve null si no quedó nada: "sin nombre". */
export function normalizarNombreCliente(texto: string | null | undefined): string | null {
  const limpio = String(texto ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NOMBRE_CLIENTE)
    .trim();
  return limpio.length > 0 ? limpio : null;
}

/** Notas generales del pedido que viajan al ERP: el nombre del cliente (para cocina y para
 *  entregar) seguido de las notas propias de la venta, si las hay. */
export function notasConNombreCliente(nombre: string | null | undefined, notas: string | null | undefined): string | undefined {
  const n = normalizarNombreCliente(nombre);
  const resto = (notas ?? "").trim();
  const partes = [n ? `Cliente: ${n}` : "", resto].filter(Boolean);
  return partes.length > 0 ? partes.join(" · ") : undefined;
}
