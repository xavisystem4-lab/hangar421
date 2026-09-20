import { EstadoPedido } from "@hangar421/shared";

/**
 * Lógica pura de la consulta de ventas del ERP (rangos de fecha y resumen).
 *
 * Vive aparte del servicio para poder probarla sin Prisma: el cálculo del día en la zona horaria
 * de la sucursal es justo donde se colaban los errores difíciles de ver, porque el servidor
 * corre en UTC y el negocio en America/Mexico_City.
 */

export interface FiltroVentas {
  sucursalId?: string;
  desde?: string;
  hasta?: string;
  estado?: EstadoPedido;
  busqueda?: string;
  limite?: number;
  offset?: number;
}

/** Estados que cuentan como venta real cobrada. Todo lo demás son tickets en curso o anulados:
 *  se listan igual (hace falta verlos para detectar una venta a medio sincronizar), pero no
 *  suman al total. */
export const ESTADOS_VENTA_CERRADA: EstadoPedido[] = [EstadoPedido.COBRADO];

const TOPE_PAGINA = 200;
const PAGINA_POR_DEFECTO = 50;

export function normalizarPaginacion(limite?: number, offset?: number): { take: number; skip: number } {
  // Un límite absurdo (0, negativo, no numérico) cae al valor por defecto en vez de recortarse
  // a 1: devolver una sola fila por un parámetro mal escrito parecería "no hay ventas".
  const pedido = Number(limite);
  const take = Number.isFinite(pedido) && pedido >= 1 ? Math.min(Math.floor(pedido), TOPE_PAGINA) : PAGINA_POR_DEFECTO;

  const desplazamiento = Number(offset);
  const skip = Number.isFinite(desplazamiento) && desplazamiento > 0 ? Math.floor(desplazamiento) : 0;

  return { take, skip };
}

/**
 * Convierte un día del calendario ("2026-09-20") al instante UTC en que ese día empieza o
 * termina en una zona horaria dada.
 *
 * Es el arreglo del error de día: el servidor corre en UTC, así que `new Date().setHours(0,0,0,0)`
 * daba las 00:00 UTC, que en México son las 18:00 del día ANTERIOR. Con eso, "las ventas de hoy"
 * incluían la tarde-noche de ayer y se cortaban a las 18:00 de hoy.
 *
 * Se calcula con `Intl` en vez de un desfase fijo para que el horario de verano no lo rompa.
 */
export function limiteDelDia(dia: string, zona: string, extremo: "inicio" | "fin"): Date {
  // Formato estricto: "20-09-2026" partido por guiones también da tres números, y sin esta
  // comprobación se interpretaría como el año 20.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) throw new Error(`Fecha inválida: ${dia}`);
  const [anio, mes, dd] = dia.split("-").map(Number);
  if (mes < 1 || mes > 12 || dd < 1 || dd > 31) throw new Error(`Fecha inválida: ${dia}`);

  const hora = extremo === "inicio" ? 0 : 23;
  const minuto = extremo === "inicio" ? 0 : 59;
  const segundo = extremo === "inicio" ? 0 : 59;
  const ms = extremo === "inicio" ? 0 : 999;

  // Primera aproximación: tratar la hora local deseada como si fuera UTC. Luego se mide cuánto
  // se desvía esa fecha al mirarla en la zona real y se corrige. Dos pasadas bastan incluso en
  // los saltos de horario de verano.
  let instante = Date.UTC(anio, mes - 1, dd, hora, minuto, segundo, ms);
  for (let i = 0; i < 2; i++) {
    const desfase = desfaseZonaMs(new Date(instante), zona);
    instante = Date.UTC(anio, mes - 1, dd, hora, minuto, segundo, ms) - desfase;
  }
  return new Date(instante);
}

/** Cuántos ms va la zona por delante de UTC en ese instante concreto. */
function desfaseZonaMs(instante: Date, zona: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: zona,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const parte of fmt.formatToParts(instante)) p[parte.type] = parte.value;
  // `hour` puede venir como "24" para medianoche en algunos entornos.
  const horas = Number(p.hour) % 24;
  const comoUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), horas, Number(p.minute), Number(p.second));
  // `comoUtc` no lleva milisegundos: hay que comparar contra el instante truncado al segundo, o
  // el desfase sale casi un segundo corto y el fin del día queda en 00:00:00.997 del día
  // siguiente en vez de 23:59:59.999.
  const instanteEnSegundos = Math.floor(instante.getTime() / 1000) * 1000;
  return comoUtc - instanteEnSegundos;
}

/** Día de hoy ("YYYY-MM-DD") en la zona de la sucursal, no en la del servidor. */
export function hoyEnZona(zona: string, ahora = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" });
  return fmt.format(ahora);
}

export interface ResumenVentas {
  totalVendido: number;
  numTickets: number;
  ticketPromedio: number;
  /** Cuántos tickets hay en cada estado. Sirve para ver de un vistazo si quedó alguna venta a
   *  medio sincronizar (un pedido que llegó pero cuyo pago no). */
  porEstado: { estado: string; cantidad: number; total: number }[];
}

export function armarResumen(filas: { estado: string; total: number }[]): ResumenVentas {
  const porEstado = new Map<string, { cantidad: number; total: number }>();
  for (const f of filas) {
    const actual = porEstado.get(f.estado) ?? { cantidad: 0, total: 0 };
    porEstado.set(f.estado, { cantidad: actual.cantidad + 1, total: redondear(actual.total + f.total) });
  }

  const cerradas = filas.filter((f) => ESTADOS_VENTA_CERRADA.includes(f.estado as EstadoPedido));
  const totalVendido = redondear(cerradas.reduce((s, f) => s + f.total, 0));

  return {
    totalVendido,
    numTickets: cerradas.length,
    ticketPromedio: cerradas.length > 0 ? redondear(totalVendido / cerradas.length) : 0,
    porEstado: [...porEstado.entries()]
      .map(([estado, v]) => ({ estado, cantidad: v.cantidad, total: v.total }))
      .sort((a, b) => b.cantidad - a.cantidad),
  };
}

function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}
