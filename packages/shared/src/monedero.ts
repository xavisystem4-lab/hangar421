import { round2 } from "./calculos";

/**
 * Crédito de empleado: un monedero electrónico por empleada, con un tope (por defecto $500) que
 * se va gastando con sus consumos y se REINICIA a un día y hora fijos de la semana — el saldo no
 * se acumula: lo que sobró se pierde en el reinicio. Es el mismo monedero en cualquier sucursal.
 *
 * Todo son funciones puras; las fechas se interpretan en la hora LOCAL del equipo (la de la
 * sucursal), que es la que usa el negocio para decir "viernes 9 PM".
 */

export const MONEDERO_LIMITE_DEFAULT = 500;

/** Cuándo se reinicia el monedero de una empleada: día de la semana (0 = domingo … 6 = sábado) y hora. */
export interface ReglaReinicioMonedero {
  diaSemana: number;
  hora: number;
  minuto?: number;
}

/** Inicio del periodo vigente: la última vez que, a esa hora y día, el monedero se reinició. */
export function inicioPeriodoMonedero(ahora: Date, regla: ReglaReinicioMonedero): Date {
  const inicio = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), regla.hora, regla.minuto ?? 0, 0, 0);
  const diasAtras = (ahora.getDay() - regla.diaSemana + 7) % 7;
  inicio.setDate(inicio.getDate() - diasAtras);
  if (inicio.getTime() > ahora.getTime()) inicio.setDate(inicio.getDate() - 7);
  return inicio;
}

export interface ConsumoMonedero {
  monto: number;
  /** Cuándo se consumió (ISO o Date). */
  fecha: string | Date;
}

/** Saldo disponible: el tope menos lo consumido desde el último reinicio. Nunca negativo. */
export function saldoMonedero(limite: number, consumos: ConsumoMonedero[], inicioPeriodo: Date): number {
  const gastado = consumos.reduce((acc, c) => (new Date(c.fecha).getTime() >= inicioPeriodo.getTime() ? acc + c.monto : acc), 0);
  return round2(Math.max(limite - gastado, 0));
}

/** Cuánto de la cuenta cubre el monedero y cuánto queda por cobrar con otro método. */
export function calcularUsoMonedero(total: number, saldo: number): { montoMonedero: number; restante: number } {
  const montoMonedero = round2(Math.min(Math.max(saldo, 0), Math.max(total, 0)));
  return { montoMonedero, restante: round2(Math.max(total, 0) - montoMonedero) };
}
