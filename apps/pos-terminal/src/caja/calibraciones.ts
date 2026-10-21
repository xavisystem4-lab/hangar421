import { factorConversionUnidad } from "@hangar421/shared";

/**
 * Calibraciones de la máquina de café al cerrar el turno. Cada calibración tira el café de un
 * shot de prueba: se registra como MERMA del café en grano para que el inventario cuadre.
 * Lógica pura, probada en calibraciones.spec.ts.
 */
export const GRAMOS_POR_CALIBRACION = 20;
export const MAX_CALIBRACIONES = 50;

/** El café en grano de la sucursal: primero "Café en grano", si no, cualquier insumo de café
 *  medido en peso. Nunca una preparación ni algo que solo mencione café (vasos, bolsas). */
export function elegirInsumoCafe<T extends { nombre: string; unidadMedida: string; activo: boolean }>(insumos: T[]): T | null {
  const limpio = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const activos = insumos.filter((i) => i.activo);
  const enPeso = (i: T) => factorConversionUnidad("g", i.unidadMedida) !== null;
  return (
    activos.find((i) => /^cafe en grano/.test(limpio(i.nombre)) && enPeso(i)) ??
    activos.find((i) => /^cafe\b/.test(limpio(i.nombre)) && !/bolsa|vaso|tapa/.test(limpio(i.nombre)) && enPeso(i)) ??
    null
  );
}

/** Merma en la unidad del insumo (20 g por calibración; si el café está en kg, 0.02 kg). */
export function mermaPorCalibraciones(calibraciones: number, unidadInsumo: string): number {
  const n = Math.floor(Number(calibraciones));
  if (!Number.isFinite(n) || n <= 0) return 0;
  const factor = factorConversionUnidad("g", unidadInsumo) ?? 1;
  return Math.round(Math.min(n, MAX_CALIBRACIONES) * GRAMOS_POR_CALIBRACION * factor * 1000) / 1000;
}
