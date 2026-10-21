import { round2 } from "@hangar421/shared";
import type { PagoVenta } from "../db/ventasRepo";

/**
 * Pago MIXTO: una parte en efectivo y otra con tarjeta, transferencia, dólares… El cajero escribe
 * cuánto entra por cada método y aquí se arman los pagos de la venta.
 *
 * Orden: primero lo que no da cambio (tarjeta, transferencia, en línea) por su monto exacto,
 * luego los dólares y al final los pesos en efectivo, que cubren el resto y son los únicos que dan
 * cambio. Cada pago guarda lo que CUBRE (`monto`), que es lo que suma el corte; lo entregado va
 * en `montoRecibido` / `montoUsd`.
 */
export interface EntradaMixta {
  metodo: string;
  /** Pesos; en EFECTIVO_USD son dólares. */
  cantidad: number;
  referencia?: string;
}

export interface ResultadoMixto {
  pagos: PagoVenta[];
  /** Lo que falta por cubrir (en pesos). */
  faltante: number;
  /** Cambio en pesos que se le da al cliente. */
  cambio: number;
  /** Por qué no se puede usar así (null = válido cuando faltante sea 0). */
  error: string | null;
}

const SIN_CAMBIO = (m: string) => m !== "EFECTIVO" && m !== "EFECTIVO_USD";

export function armarPagosMixtos(total: number, entradas: EntradaMixta[], tipoCambio: number | null): ResultadoMixto {
  const validas = entradas.filter((e) => Number(e.cantidad) > 0);
  let restante = round2(Math.max(total, 0));
  const pagos: PagoVenta[] = [];

  const sinCambio = validas.filter((e) => SIN_CAMBIO(e.metodo));
  const sumaSinCambio = round2(sinCambio.reduce((s, e) => s + Number(e.cantidad), 0));
  if (sumaSinCambio > restante + 0.001) {
    return { pagos: [], faltante: 0, cambio: 0, error: `Tarjeta, transferencia y demás no pueden pasar de $${restante.toFixed(2)} (no dan cambio).` };
  }
  for (const e of sinCambio) {
    const monto = round2(Number(e.cantidad));
    pagos.push({ metodo: e.metodo, monto, ...(e.referencia ? { referencia: e.referencia } : {}) });
    restante = round2(restante - monto);
  }

  let cambio = 0;
  const usd = validas.find((e) => e.metodo === "EFECTIVO_USD");
  if (usd) {
    if (!tipoCambio || tipoCambio <= 0) {
      return { pagos: [], faltante: restante, cambio: 0, error: "Falta el tipo de cambio del dólar: fíjalo en Caja." };
    }
    const equivalente = round2(Number(usd.cantidad) * tipoCambio);
    const monto = round2(Math.min(equivalente, restante));
    if (monto > 0) pagos.push({ metodo: "EFECTIVO_USD", monto, montoUsd: round2(Number(usd.cantidad)), tipoCambio });
    cambio = round2(cambio + Math.max(equivalente - restante, 0));
    restante = round2(restante - monto);
  }

  const mxn = validas.find((e) => e.metodo === "EFECTIVO");
  if (mxn) {
    const entregado = round2(Number(mxn.cantidad));
    const monto = round2(Math.min(entregado, restante));
    if (monto > 0) pagos.push({ metodo: "EFECTIVO", monto, montoRecibido: entregado });
    cambio = round2(cambio + Math.max(entregado - restante, 0));
    restante = round2(restante - monto);
  }

  return { pagos, faltante: round2(Math.max(restante, 0)), cambio, error: null };
}
