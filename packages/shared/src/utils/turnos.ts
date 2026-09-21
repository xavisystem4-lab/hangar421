/**
 * Regla del aviso de "turno sin cerrar desde un día anterior" para los puntos de venta.
 *
 * Se compara por DÍA DE CALENDARIO en el reloj del equipo, no por horas transcurridas: un turno
 * abierto ayer a las 22:00 ya está pendiente a las 08:00 de hoy aunque solo hayan pasado diez
 * horas, y uno abierto hoy a las 00:30 no lo está. El equipo (POS Windows o tablet) está en la
 * sucursal, así que su zona horaria es la de la sucursal.
 *
 * El ERP aplica la misma regla con la zona de la sucursal (backend, caja/turnos-consulta.ts),
 * porque el servidor corre en UTC.
 */
export function turnoDeDiaAnterior(
  turno: { estado: string; fechaApertura: Date | string },
  ahora: Date = new Date(),
): boolean {
  if (turno.estado !== "ABIERTO") return false;
  const apertura = new Date(turno.fechaApertura);
  if (Number.isNaN(apertura.getTime())) return false;
  const inicioDeHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  return apertura < inicioDeHoy;
}

/** Cuántos días de calendario lleva abierto (1 = desde ayer). Para el texto del aviso. */
export function diasDeTurnoAbierto(fechaApertura: Date | string, ahora: Date = new Date()): number {
  const a = new Date(fechaApertura);
  const inicioApertura = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const inicioHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()).getTime();
  return Math.max(0, Math.round((inicioHoy - inicioApertura) / 86_400_000));
}
