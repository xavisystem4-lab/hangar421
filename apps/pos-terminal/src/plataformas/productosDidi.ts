/**
 * Productos de un pedido de DiDi leídos del texto de la notificación, y su pareja en el catálogo.
 * Lógica pura (probada en productosDidi.spec.ts).
 *
 * DiDi no publica el formato y muchas veces la notificación NO trae los productos (solo "Tienes
 * un pedido nuevo #123"). Cuando sí los trae suelen venir como "2x Latte", "Latte x2" o
 * "1 Frappé moka $85". Lo que no se pueda emparejar se le enseña al cajero para que elija el
 * producto; nunca se inventa.
 */

export interface LineaLeida {
  cantidad: number;
  /** Nombre tal como lo escribió DiDi. */
  nombre: string;
  /** Importe de la línea si venía ("$85"). Solo informativo: se cobra el precio del catálogo. */
  precio: number | null;
}

export interface ProductoCatalogo {
  id: string;
  nombre: string;
  subcategoria: string | null;
  categoria: string | null;
  precio: number;
}

export interface ItemPedidoDidi {
  /** Texto original de la línea ("2x Latte grande"); vacío si lo agregó el cajero. */
  leido: string;
  cantidad: number;
  productoId: string | null;
  nombreProducto: string | null;
  precioUnitario: number | null;
  categoria: string | null;
  /** "exacto" | "aproximado" | null (sin pareja: el cajero elige). */
  coincidencia: "exacto" | "aproximado" | null;
}

const RUIDO_LINEA = /^(total|subtotal|envío|envio|propina|descuento|cliente|pedido|orden|order|entrega|repartidor|pago|método|metodo|#)/i;

function normalizar(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/\p{Mn}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function aNumero(t: string): number | null {
  const n = Number(t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Busca líneas de producto. Formatos reconocidos (uno por renglón, o varios separados por coma,
 * "·", "•" o ";"):
 *   "2x Latte"  "2 x Latte"  "2× Latte"  "Latte x2"  "Latte x 2"  "1 Frappé moka $85.00"
 */
export function extraerLineasProducto(texto: string): LineaLeida[] {
  const partes = (texto ?? "")
    .split(/\r?\n|[•·;]|,(?=\s*\d+\s*[x×]?\s*\D)/)
    .map((p) => p.trim())
    .filter(Boolean);
  const lineas: LineaLeida[] = [];
  for (const parte of partes) {
    if (RUIDO_LINEA.test(parte)) continue;
    const sinPrecio = parte.replace(/\s*\$\s*[\d.,]+\s*$/, "").trim();
    const precioTxt = parte.match(/\$\s*([\d.,]+)\s*$/)?.[1];
    const precio = precioTxt ? aNumero(precioTxt) : null;

    let m = sinPrecio.match(/^(\d{1,2})\s*[x×]\s*(.{2,60})$/i);
    if (m) { lineas.push({ cantidad: Number(m[1]), nombre: m[2].trim(), precio }); continue; }
    m = sinPrecio.match(/^(.{2,60}?)\s*[x×]\s*(\d{1,2})$/i);
    if (m) { lineas.push({ cantidad: Number(m[2]), nombre: m[1].trim(), precio }); continue; }
    m = sinPrecio.match(/^(\d{1,2})\s+([A-Za-zÁÉÍÓÚÑáéíóúñ].{1,59})$/);
    if (m && !/pedido|orden|productos?|art[ií]culos?/i.test(m[2])) {
      lineas.push({ cantidad: Number(m[1]), nombre: m[2].trim(), precio });
    }
  }
  return lineas.filter((l) => l.cantidad > 0 && l.cantidad <= 50);
}

/** Qué tanto se parecen dos nombres: 1 = iguales; proporción de palabras del más corto presentes en el otro. */
function parecido(a: string, b: string): number {
  const na = normalizar(a);
  const nb = normalizar(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const pa = na.split(" ");
  const pb = new Set(nb.split(" "));
  const corto = pa.length <= pb.size ? pa : nb.split(" ");
  const largo = pa.length <= pb.size ? pb : new Set(pa);
  const comunes = corto.filter((w) => largo.has(w)).length;
  return comunes / Math.max(corto.length, 1) * (corto.length / Math.max(largo.size, corto.length)) ** 0.25;
}

/**
 * Empareja cada línea con un producto del catálogo. Prefiere el grupo DIDI (sus precios son los
 * de la plataforma); si no hay, cualquier producto. Por debajo de 0.6 de parecido no se empareja.
 */
export function emparejarConCatalogo(lineas: LineaLeida[], catalogo: ProductoCatalogo[], categoriaPreferida = "DIDI"): ItemPedidoDidi[] {
  const pref = normalizar(categoriaPreferida);
  return lineas.map((l) => {
    let mejor: { p: ProductoCatalogo; puntos: number } | null = null;
    for (const p of catalogo) {
      const base = Math.max(parecido(l.nombre, p.nombre), p.subcategoria ? parecido(l.nombre, `${p.nombre} ${p.subcategoria}`) : 0);
      if (base < 0.6) continue;
      const puntos = base + (normalizar(p.categoria ?? "") === pref ? 0.05 : 0);
      if (!mejor || puntos > mejor.puntos) mejor = { p, puntos };
    }
    const leido = `${l.cantidad}x ${l.nombre}`;
    if (!mejor) return { leido, cantidad: l.cantidad, productoId: null, nombreProducto: null, precioUnitario: null, categoria: null, coincidencia: null };
    return {
      leido,
      cantidad: l.cantidad,
      productoId: mejor.p.id,
      nombreProducto: mejor.p.nombre,
      precioUnitario: mejor.p.precio,
      categoria: mejor.p.categoria,
      coincidencia: normalizar(mejor.p.nombre) === normalizar(l.nombre) ? "exacto" : "aproximado",
    };
  });
}

/** Un pedido se puede confirmar cuando trae al menos un producto y todos tienen pareja. */
export function pedidoListoParaConfirmar(items: ItemPedidoDidi[]): boolean {
  return items.length > 0 && items.every((i) => i.productoId && i.cantidad > 0);
}

export function totalItems(items: ItemPedidoDidi[]): number {
  return Math.round(items.reduce((s, i) => s + (i.precioUnitario ?? 0) * i.cantidad, 0) * 100) / 100;
}
