import { hoyEnZona, limiteDelDia } from "../pedidos/ventas-consulta";

/**
 * true si el turno sigue abierto y se abrió ANTES de hoy (en la zona de la sucursal): un turno
 * que alguien olvidó cerrar el día anterior. Es lo que dispara el aviso al iniciar operaciones.
 *
 * "Antes de hoy" y no "hace más de 24 h": un turno abierto ayer a las 22:00 ya está pendiente a
 * las 08:00 de hoy, aunque solo hayan pasado diez horas.
 */
export function esTurnoDeDiaAnterior(
  turno: { estado: string; fechaApertura: Date },
  zona: string,
  ahora = new Date(),
): boolean {
  if (turno.estado !== "ABIERTO") return false;
  return turno.fechaApertura < limiteDelDia(hoyEnZona(zona, ahora), zona, "inicio");
}
