/**
 * Interpretación de las notificaciones de la app de DiDi (Comercios) captadas en la misma
 * tablet (ver modules/hangar-notificaciones). Lógica pura, probada en notificacionesDidi.spec.ts.
 *
 * DiDi no publica el formato de sus notificaciones y puede cambiarlo, así que esto es
 * heurístico a propósito: se busca "pedido nuevo", un número de pedido y un importe en el título
 * y el texto. Lo que no se reconozca llega igual a la bandeja de Admin → Plataformas con su
 * texto original, para que el cajero lo revise y registre a mano.
 */
export interface NotificacionInterpretada {
  /** Se distingue de otras notificaciones (chat, promociones, "pedido entregado"…). */
  esPedidoNuevo: boolean;
  /** Es ruido seguro (resumen, promoción, actualización de la app): no vale la pena avisar. */
  esRuido: boolean;
  /** Número corto del pedido tal como lo muestra DiDi, sin "#". */
  numeroPedido: string | null;
  /** Importe en pesos, si viene en el texto. */
  total: number | null;
  /** Nombre del cliente, si viene ("de Juan Pérez" / "Cliente: Ana"). */
  cliente: string | null;
  /** Una línea para el banner y la lista. */
  resumen: string;
}

const PALABRAS_PEDIDO_NUEVO = [
  /nuevo pedido/i, /pedido nuevo/i, /nueva orden/i, /orden nueva/i, /new order/i, /tienes un pedido/i,
  /pedido entrante/i, /pedido recibido/i, /acepta(r)? (el )?pedido/i, /has recibido un pedido/i, /pedido pendiente/i,
];
const PALABRAS_RUIDO = [
  /entregad[oa]/i, /cancelad[oa]/i, /repartidor (va|está|lleg)/i, /en camino/i, /califica/i, /promoci[oó]n/i,
  /actualiza(r)? la app/i, /nueva versi[oó]n/i, /encuesta/i, /recordatorio/i, /notificaciones? nuevas?/i,
];

/** Normaliza espacios (los acentos se conservan: el nombre del cliente debe salir tal cual). */
function limpiar(texto: string): string {
  return (texto ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
}

export function interpretarNotificacion(n: { titulo: string; texto: string }): NotificacionInterpretada {
  const titulo = limpiar(n.titulo);
  const texto = limpiar(n.texto);
  const todo = `${titulo} ${texto}`;

  const esPedidoNuevo = PALABRAS_PEDIDO_NUEVO.some((re) => re.test(todo));
  const esRuido = !esPedidoNuevo && PALABRAS_RUIDO.some((re) => re.test(todo));

  // "#1234", "No. 1234", "pedido 1234", "orden A1B2C3" (DiDi usa números de 3 a 12 cifras o
  // códigos cortos alfanuméricos; se toma el primero que aparezca junto a "pedido/orden/#").
  const numero =
    todo.match(/#\s*([A-Z0-9-]{3,14})/i)?.[1] ??
    todo.match(/\b(?:pedido|orden|order|no\.?|num\.?|folio)\s*:?\s*#?\s*((?=[A-Z-]*\d)[A-Z0-9-]{3,14})\b/i)?.[1] ??
    null;

  // "$180.00", "$ 1,250", "MXN 180", "180.00 MXN"
  const importe =
    todo.match(/\$\s*([\d.,]+)/)?.[1] ??
    todo.match(/\bMXN\s*([\d.,]+)/i)?.[1] ??
    todo.match(/([\d.,]+)\s*MXN\b/i)?.[1] ??
    todo.match(/\btotal\s*:?\s*([\d.,]+)/i)?.[1] ??
    null;
  const total = importe ? aNumero(importe) : null;

  const cliente =
    todo.match(/\bcliente\s*:?\s*([A-Za-zÁÉÍÓÚÑáéíóúñ][\wÁÉÍÓÚÑáéíóúñ .'-]{1,40}?)(?=\s*(?:[#$·|,.-]|\bpedido\b|\borden\b|\btotal\b|$))/i)?.[1]?.trim() ??
    todo.match(/\bde\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,3})(?=\s*(?:[#$·|,.-]|\bpor\b|$))/)?.[1]?.trim() ??
    null;

  const partes: string[] = [];
  if (numero) partes.push(`#${numero.toUpperCase()}`);
  if (total != null) partes.push(`$${total.toFixed(2)}`);
  if (cliente) partes.push(cliente);
  const resumen = esPedidoNuevo
    ? `Nuevo pedido DiDi${partes.length ? " " + partes.join(" · ") : ""}`
    : [titulo, texto].filter(Boolean).join(" — ").slice(0, 120) || "Notificación de DiDi";

  return { esPedidoNuevo, esRuido, numeroPedido: numero ? numero.toUpperCase() : null, total, cliente, resumen };
}

/** "1,250.50" → 1250.5 ; "180" → 180 ; "1.250,50" (coma decimal) → 1250.5 */
export function aNumero(texto: string): number | null {
  let t = texto.trim();
  if (!t) return null;
  const comaDecimal = /,\d{1,2}$/.test(t) && !/\.\d{1,2}$/.test(t);
  t = comaDecimal ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

/** Nombre que lleva el pedido en el carrito, el ticket y la comanda cuando se registra desde
 *  una notificación: con él se encuentra luego la venta por el número de DiDi. */
export function nombrePedidoDidi(n: NotificacionInterpretada): string {
  const partes = ["DiDi"];
  if (n.numeroPedido) partes.push(`#${n.numeroPedido}`);
  if (n.cliente) partes.push(n.cliente);
  return partes.join(" ");
}

/** Qué notificaciones ameritan aviso (sonido/banner): pedidos nuevos y, por si el formato
 *  cambió, las no reconocidas que tampoco son ruido claro. */
export function ameritaAviso(n: NotificacionInterpretada): boolean {
  return n.esPedidoNuevo || !n.esRuido;
}
