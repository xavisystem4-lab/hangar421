import { round2 } from "./calculos";

/**
 * Promociones de catálogo: un PRECIO ESPECIAL para los productos que se elijan — precio directo
 * (Latte a $49) o porcentaje de descuento — válido en ciertas fechas, días de la semana y horario.
 * Se aplica sola al agregar el producto a la venta mientras esté vigente. Es el mismo cálculo en la
 * tablet y en el servidor, para que el total del ticket y el del ERP coincidan.
 *
 * Funciones puras. Las fechas y horas se leen en la hora LOCAL del equipo (la de la sucursal),
 * igual que el monedero de empleada.
 */

export type TipoPromocion = "PRECIO" | "PORCENTAJE";

export interface PromocionRegla {
  tipo: TipoPromocion;
  /** PRECIO: el precio especial en pesos. PORCENTAJE: el descuento, de 0 a 100 (exclusivo de 0). */
  valor: number;
}

export interface Promocion extends PromocionRegla {
  id: string;
  nombre: string;
  productoIds: string[];
  /** Días en que aplica, 0 = domingo … 6 = sábado. Vacío = todos los días. */
  dias: number[];
  /** "HH:MM" 24 h. Ambos vacíos = todo el día. */
  horaInicio?: string | null;
  horaFin?: string | null;
  /** "YYYY-MM-DD", ambos extremos incluidos. Vacío = sin límite por ese lado. */
  fechaInicio?: string | null;
  fechaFin?: string | null;
  /** null/undefined = todas las sucursales. */
  sucursalId?: string | null;
  activo: boolean;
}

/** "HH:MM" → minutos desde la medianoche, o null si no es una hora válida. */
export function minutosDeHora(hora: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hora ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h <= 23 && min <= 59 ? h * 60 + min : null;
}

/** Fecha local del equipo como "YYYY-MM-DD" (comparable como texto). */
export function fechaLocalISO(d: Date): string {
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

/** ¿La promoción aplica en este momento y en esta sucursal? */
export function promocionVigente(p: Promocion, ahora: Date, sucursalId?: string | null): boolean {
  if (!p.activo) return false;
  if (p.sucursalId && sucursalId && p.sucursalId !== sucursalId) return false;
  if (p.dias.length > 0 && !p.dias.includes(ahora.getDay())) return false;
  const hoy = fechaLocalISO(ahora);
  if (p.fechaInicio && hoy < p.fechaInicio) return false;
  if (p.fechaFin && hoy > p.fechaFin) return false;
  const desde = minutosDeHora(p.horaInicio);
  const hasta = minutosDeHora(p.horaFin);
  if (desde !== null || hasta !== null) {
    const minutos = ahora.getHours() * 60 + ahora.getMinutes();
    if (desde !== null && minutos < desde) return false;
    if (hasta !== null && minutos >= hasta) return false;
  }
  return true;
}

/** Precio unitario con la promoción (sin extras de modificadores, que se suman aparte). */
export function precioConPromocion(regla: PromocionRegla, precioLista: number): number {
  const precio = regla.tipo === "PRECIO" ? regla.valor : precioLista * (1 - regla.valor / 100);
  return Math.max(0, round2(precio));
}

export interface PromocionAplicada {
  promocion: Promocion;
  precio: number;
}

/** La promoción vigente que deja el producto MÁS barato (solo cuenta si de verdad baja el precio). */
export function mejorPromocion(
  promociones: Promocion[],
  productoId: string,
  precioLista: number,
  ahora: Date,
  sucursalId?: string | null,
): PromocionAplicada | null {
  let mejor: PromocionAplicada | null = null;
  for (const promocion of promociones) {
    if (!promocion.productoIds.includes(productoId) || !promocionVigente(promocion, ahora, sucursalId)) continue;
    const precio = precioConPromocion(promocion, precioLista);
    if (precio >= precioLista) continue;
    if (!mejor || precio < mejor.precio) mejor = { promocion, precio };
  }
  return mejor;
}

const NOMBRES_DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

/** "Lun a Vie · 14:00–17:00 · del 01/10/2026 al 31/10/2026" — para la lista de Admin. */
export function describirVigencia(p: Pick<Promocion, "dias" | "horaInicio" | "horaFin" | "fechaInicio" | "fechaFin">): string {
  const partes: string[] = [];
  const dias = [...new Set(p.dias)].sort((a, b) => a - b);
  if (dias.length === 0 || dias.length === 7) partes.push("Todos los días");
  else partes.push(dias.map((d) => NOMBRES_DIAS[d]).join(", "));
  if (p.horaInicio || p.horaFin) partes.push(`${p.horaInicio || "00:00"}–${p.horaFin || "24:00"}`);
  const fecha = (iso?: string | null) => (iso ? iso.split("-").reverse().join("/") : "");
  if (p.fechaInicio && p.fechaFin) partes.push(`del ${fecha(p.fechaInicio)} al ${fecha(p.fechaFin)}`);
  else if (p.fechaInicio) partes.push(`desde el ${fecha(p.fechaInicio)}`);
  else if (p.fechaFin) partes.push(`hasta el ${fecha(p.fechaFin)}`);
  return partes.join(" · ");
}
