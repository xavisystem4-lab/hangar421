/**
 * Presentación (empaque) de un insumo: cómo se compra y se cuenta, frente a cómo se consume.
 *
 * La leche se consume en ml (la receta dice 240 ml), pero en el almacén se cuenta en cartones de
 * 1000 ml. Sin esto, el encargado tiene que multiplicar de cabeza para capturar "4 cartones" y
 * acaba escribiendo 4 donde debía escribir 4000.
 *
 * `porPaquete` es cuántas unidades base trae un paquete (1000 ml por cartón). La existencia SIEMPRE
 * se guarda en unidad base: la presentación solo cambia cómo se captura y cómo se lee.
 */

export interface Presentacion {
  /** Cómo se le llama al empaque: "Cartón", "Caja", "Bolsa". */
  nombre: string;
  /** Unidades base que trae un empaque (1000 ml por cartón). */
  porPaquete: number;
}

export interface CantidadEnPaquetes {
  /** Empaques completos. */
  paquetes: number;
  /** Lo suelto, en unidad base (300 ml de un cartón abierto). */
  sueltos: number;
}

/** Hay presentación utilizable cuando trae nombre y un tamaño de paquete mayor que uno. */
export function tienePresentacion(p?: Presentacion | null): p is Presentacion {
  return !!p && !!String(p.nombre ?? "").trim() && Number(p.porPaquete) > 1;
}

function redondear4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10_000) / 10_000;
}

/** "2 cartones y 300 ml" → 2300 ml. Lo que no sea un número válido cuenta como 0. */
export function aUnidadBase(cantidad: Partial<CantidadEnPaquetes>, porPaquete: number): number {
  const paquetes = Number(cantidad.paquetes);
  const sueltos = Number(cantidad.sueltos);
  const total =
    (Number.isFinite(paquetes) ? paquetes : 0) * (Number(porPaquete) > 0 ? Number(porPaquete) : 0) +
    (Number.isFinite(sueltos) ? sueltos : 0);
  return redondear4(total);
}

/** 2300 ml con cartones de 1000 → { paquetes: 2, sueltos: 300 }. Sin presentación, todo va suelto. */
export function aPaquetes(totalBase: number, porPaquete: number): CantidadEnPaquetes {
  const total = Number(totalBase) || 0;
  const tamano = Number(porPaquete);
  if (!(tamano > 1)) return { paquetes: 0, sueltos: redondear4(total) };
  // El signo se conserva: una existencia negativa (venta sin entrada registrada) se lee igual.
  const signo = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const paquetes = Math.floor(abs / tamano);
  return { paquetes: signo * paquetes, sueltos: signo * redondear4(abs - paquetes * tamano) };
}

/**
 * Texto para leer una existencia de un vistazo: "4 cartones", "2 cartones + 300 ml", "300 ml".
 * `plural` evita escribir "1 cartones"; si no se da, se añade una "s" simple.
 */
export function describirEnPaquetes(
  totalBase: number,
  presentacion: Presentacion | null | undefined,
  unidadBase: string,
  plural?: string,
): string {
  const base = `${redondear4(Number(totalBase) || 0)} ${unidadBase}`.trim();
  if (!tienePresentacion(presentacion)) return base;
  const { paquetes, sueltos } = aPaquetes(totalBase, presentacion.porPaquete);
  if (paquetes === 0) return base;
  const nombre = Math.abs(paquetes) === 1 ? presentacion.nombre : (plural ?? `${presentacion.nombre}s`);
  const parteEmpaques = `${paquetes} ${nombre}`;
  return sueltos === 0 ? parteEmpaques : `${parteEmpaques} + ${redondear4(sueltos)} ${unidadBase}`;
}
