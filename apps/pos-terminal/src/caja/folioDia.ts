/** Folio del día — lógica pura.
 *
 *  Cada día la numeración de tickets vuelve a #1 para que el cajero sepa de un vistazo cuántas
 *  ventas lleva hoy. El "día" es el de la tablet (su medianoche local), no el de UTC: a las
 *  6 p. m. en México ya es mañana en UTC y el folio no debe reiniciarse ahí. */

/** ISO (UTC) de la medianoche local del día de `ahora`, comparable con `ventas.created_at`. */
export function inicioDelDiaLocal(ahora: Date): string {
  const d = new Date(ahora.getTime());
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
