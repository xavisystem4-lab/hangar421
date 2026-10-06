import { CanalOrigen, MetodoPago, TipoPedido, round2, type TotalesPedido } from "@hangar421/shared";
import type { ItemCarrito } from "../store/carritoStore";
import type { OpcionesVenta, PagoVenta } from "../db/ventasRepo";

/**
 * Lógica pura de "pedido de plataforma → venta de la terminal". Sin I/O, para poder probarla con
 * Jest (ventaPlataforma.spec.ts). El flujo completo está en aceptarPedidoPlataforma.ts.
 */

/** Pedido entrante tal como lo lista GET /plataformas/pedidos (ver PedidoEntranteDto en el backend). */
export interface PedidoEntrante {
  id: string;
  plataforma: string;
  nombreVisible: string;
  ordenExternaId: string;
  /** RECIBIDA (por aceptar) | SINCRONIZADA (aceptado) | IGNORADA (rechazado) | CANCELADA (por la plataforma) */
  estado: string;
  clienteNombre: string | null;
  totalExterno: number | string | null;
  items: { nombreExterno: string; cantidad: number; precioUnitario?: number; notas?: string; modificadores?: string[] }[];
  motivoError: string | null;
  pedidoId: string | null;
  createdAt: string;
  // Opcionales: un ERP anterior no los manda.
  folioCorto?: string | null;
  estadoExterno?: string | null;
  notas?: string | null;
  entrega?: { tipo?: string | null; repartidor?: string | null; horaEstimada?: string | null; codigoEntrega?: string | null } | null;
  montos?: { subtotal?: number | null; envio?: number | null; propina?: number | null; descuento?: number | null } | null;
  ultimoIntentoError?: string | null;
  /** CONFIRMADA | MANUAL | SIMULADA */
  confirmacion?: string | null;
  simulado?: boolean;
  puedeConfirmarEnPlataforma?: boolean;
  aceptadaEn?: string | null;
  updatedAt?: string;
}

/** Lo que el cajero eligió para cada item de la plataforma: el producto real y la cantidad. */
export interface MapeoItem {
  productoId: string;
  cantidad: number;
  notas: string;
}

/** Pedido del ERP como lo devuelve POST /plataformas/pedidos/:id/aceptar (PedidosService.obtener).
 *  Los Decimal de Prisma llegan como texto en el JSON, de ahí `number | string`. */
export interface PedidoErp {
  id: string;
  subtotal: number | string;
  descuentoTotal?: number | string;
  impuesto?: number | string;
  total: number | string;
  items: {
    id?: string;
    productoId: string;
    cantidad: number;
    precioUnitario: number | string;
    notas?: string | null;
    producto?: { nombre?: string } | null;
    modificadores?: { opcionModificadorId: string; precioExtra: number | string; opcionModificador?: { nombre?: string } | null }[];
  }[];
}

export interface ProductoParaMapeo {
  id: string;
  nombre: string;
  precioBase: number;
}

const num = (v: number | string | null | undefined) => Number(v ?? 0) || 0;

/** "Café Latte (Grande)" → "cafe latte grande" — para comparar nombres de la plataforma y del catálogo. */
export function normalizarNombre(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, " ")
    .trim();
}

/**
 * Producto del catálogo que probablemente corresponde a un nombre de la plataforma: primero
 * coincidencia exacta (normalizada); si no, el producto cuyo nombre está contenido en el de la
 * plataforma (o al revés) con el nombre más largo. Es solo una sugerencia: el cajero confirma.
 */
export function sugerirProducto(nombreExterno: string, productos: ProductoParaMapeo[]): ProductoParaMapeo | null {
  const externo = normalizarNombre(nombreExterno);
  if (!externo) return null;
  const exacto = productos.find((p) => normalizarNombre(p.nombre) === externo);
  if (exacto) return exacto;
  let mejor: ProductoParaMapeo | null = null;
  let mejorLargo = 0;
  for (const p of productos) {
    const nombre = normalizarNombre(p.nombre);
    if (nombre.length < 3) continue;
    if ((externo.includes(nombre) || nombre.includes(externo)) && nombre.length > mejorLargo) {
      mejor = p;
      mejorLargo = nombre.length;
    }
  }
  return mejor;
}

/** Productos que contienen todas las palabras de la búsqueda, para el selector del mapeo. */
export function buscarProductos(texto: string, productos: ProductoParaMapeo[], limite = 6): ProductoParaMapeo[] {
  const palabras = normalizarNombre(texto).split(" ").filter(Boolean);
  if (palabras.length === 0) return [];
  return productos.filter((p) => {
    const nombre = normalizarNombre(p.nombre);
    return palabras.every((w) => nombre.includes(w));
  }).slice(0, limite);
}

/** Problemas que impiden aceptar: items sin producto elegido o con cantidad inválida. */
export function validarMapeo(pedido: PedidoEntrante, mapeo: MapeoItem[]): string[] {
  const problemas: string[] = [];
  pedido.items.forEach((it, i) => {
    const m = mapeo[i];
    if (!m?.productoId) problemas.push(`Falta elegir el producto para "${it.nombreExterno}".`);
    if (!m || !Number.isInteger(m.cantidad) || m.cantidad < 1) problemas.push(`Cantidad inválida para "${it.nombreExterno}".`);
  });
  return problemas;
}

/** Total con los precios del catálogo de la terminal, para compararlo con el de la plataforma antes de aceptar. */
export function totalSegunCatalogo(mapeo: MapeoItem[], productos: ProductoParaMapeo[]): number {
  return round2(mapeo.reduce((s, m) => s + (productos.find((p) => p.id === m.productoId)?.precioBase ?? 0) * (m.cantidad || 0), 0));
}

/** "Pedido de DiDi #A123 — Cliente: María" — viaja como nota de la venta y del pedido. */
export function notasPedidoPlataforma(pedido: PedidoEntrante): string {
  return [`Pedido de ${pedido.nombreVisible} #${pedido.ordenExternaId}`, pedido.clienteNombre ? `Cliente: ${pedido.clienteNombre}` : null]
    .filter(Boolean)
    .join(" — ");
}

/**
 * Convierte el Pedido que creó el ERP al aceptar en los datos de la venta local. Se usan los
 * precios y totales del ERP, no los del catálogo de la tablet: el cobro que sube después por
 * /sync/push se valida contra el total del ERP y tiene que cuadrar al centavo.
 *
 * Se paga con MetodoPago.OTRO: la plataforma ya le cobró al cliente, en el cajón no entra
 * efectivo (el corte solo suma EFECTIVO). La referencia dice qué plataforma y qué orden.
 */
export function ventaDesdePedidoErp(
  pedidoErp: PedidoErp,
  pedido: PedidoEntrante,
  nombresLocales: Record<string, string> = {},
): { items: ItemCarrito[]; totales: TotalesPedido; pagos: PagoVenta[]; opciones: OpcionesVenta } {
  const items: ItemCarrito[] = pedidoErp.items.map((it, i) => ({
    id: it.id ?? `${pedidoErp.id}-${i}`,
    productoId: it.productoId,
    nombreProducto: it.producto?.nombre ?? nombresLocales[it.productoId] ?? "Producto",
    cantidad: it.cantidad,
    precioUnitario: num(it.precioUnitario),
    notas: it.notas ?? undefined,
    modificadores: (it.modificadores ?? []).map((m) => ({
      opcionModificadorId: m.opcionModificadorId,
      nombreOpcion: m.opcionModificador?.nombre ?? "",
      precioExtra: num(m.precioExtra),
    })),
  }));

  const total = round2(num(pedidoErp.total));
  return {
    items,
    totales: {
      subtotal: round2(num(pedidoErp.subtotal)),
      descuentoTotal: round2(num(pedidoErp.descuentoTotal)),
      impuesto: round2(num(pedidoErp.impuesto)),
      total,
    },
    pagos: [{ metodo: MetodoPago.OTRO, monto: total, referencia: `${pedido.nombreVisible} #${pedido.ordenExternaId}` }],
    opciones: {
      ventaId: pedidoErp.id,
      canalOrigen: CanalOrigen.PLATAFORMA_DELIVERY,
      tipo: TipoPedido.DOMICILIO,
      notas: notasPedidoPlataforma(pedido),
    },
  };
}
