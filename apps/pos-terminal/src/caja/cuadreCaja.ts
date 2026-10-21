import { round2 } from "./denominaciones";

/**
 * ¿Cuadra la caja? Regla del cierre de turno: si el efectivo no cuadra, NO se cierra (solo un
 * ADMIN puede forzarlo y queda registrado).
 *
 * Se compara el TOTAL en pesos (pesos + dólares × tipo de cambio del turno), no cada moneda por
 * separado: si un cliente pagó 7 dólares y la venta se marcó como efectivo en pesos, en pesos
 * "faltan" $110 y en dólares "sobran" US$7, pero en la caja está el dinero completo.
 */
export interface DatosCuadre {
  contadoMXN: number;
  esperadoMXN: number;
  contadoUSD: number;
  esperadoUSD: number;
  /** Pesos por dólar del turno; null = el turno no lo tiene y los dólares no se pueden convertir. */
  tipoCambio: number | null;
}

export interface ResultadoCuadre {
  /** Diferencia total en pesos (+ sobra, − falta). */
  diferencia: number;
  cuadra: boolean;
  /** Hay dólares en juego pero sin tipo de cambio: se exige que cada moneda cuadre por separado. */
  sinTipoCambio: boolean;
}

/** Menos de un peso de diferencia es redondeo del tipo de cambio, no dinero que falte. */
export const TOLERANCIA_REDONDEO = 1;

export function evaluarCuadre(d: DatosCuadre): ResultadoCuadre {
  const difMXN = round2(d.contadoMXN - d.esperadoMXN);
  const difUSD = round2(d.contadoUSD - d.esperadoUSD);
  const tc = d.tipoCambio && d.tipoCambio > 0 ? d.tipoCambio : null;
  if (difUSD !== 0 && !tc) {
    return { diferencia: difMXN, cuadra: Math.abs(difMXN) < TOLERANCIA_REDONDEO && difUSD === 0, sinTipoCambio: true };
  }
  const diferencia = round2(difMXN + difUSD * (tc ?? 0));
  return { diferencia, cuadra: Math.abs(diferencia) < TOLERANCIA_REDONDEO, sinTipoCambio: false };
}

/** "Faltan $110.00" / "Sobran $5.00" / "Cuadra". */
export function textoDiferencia(diferencia: number): string {
  if (Math.abs(diferencia) < TOLERANCIA_REDONDEO) return "Cuadra";
  return `${diferencia > 0 ? "Sobran" : "Faltan"} $${Math.abs(diferencia).toFixed(2)}`;
}
