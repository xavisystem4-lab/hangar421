/** Desglose de efectivo para el corte de caja — lógica pura, sin imports, para poder probarla.
 *
 *  Las denominaciones son las mismas que usa el POS Windows (apps/pos-desktop/src/screens/Caja.tsx):
 *  el corte tiene que cuadrar igual se haga en la caja o en la tablet, y una lista distinta en
 *  cada sitio haría que dos cajeros contaran cosas distintas. */

export const BILLETES_MXN = [1000, 500, 200, 100, 50, 20];
export const MONEDAS_MXN = [20, 10, 5, 2, 1, 0.5];
export const BILLETES_USD = [100, 50, 20, 10, 5, 1];

/** Cuántas piezas de cada denominación. La llave es el valor de la pieza. */
export type Conteo = Record<number, number>;

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Suma un conteo a dinero. Ignora cantidades vacías, negativas o no numéricas: el campo es un
 *  TextInput y el cajero puede dejarlo a medio escribir. */
export function totalConteo(conteo: Conteo): number {
  const total = Object.entries(conteo).reduce((suma, [denominacion, cantidad]) => {
    const piezas = Number(cantidad);
    if (!Number.isFinite(piezas) || piezas <= 0) return suma;
    return suma + Number(denominacion) * piezas;
  }, 0);
  return round2(total);
}

export interface DesgloseEfectivo {
  billetesMXN: Conteo;
  monedasMXN: Conteo;
  billetesUSD: Conteo;
  totalMXN: number;
  totalUSD: number;
  observaciones?: string;
}

/** Arma el desglose con la MISMA forma que manda el POS Windows, para que el ERP reciba un solo
 *  formato venga de donde venga (ver CajaService.cerrarTurno, que lo guarda tal cual para
 *  auditarlo después). */
export function construirDesglose(
  billetesMXN: Conteo,
  monedasMXN: Conteo,
  billetesUSD: Conteo,
  observaciones?: string,
): DesgloseEfectivo {
  return {
    billetesMXN,
    monedasMXN,
    billetesUSD,
    // El dólar va aparte y NO se suma al efectivo MXN esperado: mismo criterio que el POS
    // Windows. Es informativo hasta que alguien lo cambie a pesos en una operación aparte.
    totalMXN: round2(totalConteo(billetesMXN) + totalConteo(monedasMXN)),
    totalUSD: totalConteo(billetesUSD),
    observaciones: observaciones?.trim() || undefined,
  };
}

/** Diferencia entre lo contado y lo que el sistema espera. Positiva = sobra dinero en caja. */
export function calcularDiferencia(totalContadoMXN: number, montoEsperado: number): number {
  return round2(totalContadoMXN - montoEsperado);
}
