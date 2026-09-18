/** Lógica pura (sin I/O, sin módulos nativos) separada de offlineAuth.ts a propósito — así se
 *  puede probar bajo Jest/Node sin arrastrar el import de expo-crypto (módulo nativo ESM-only
 *  que Jest no puede transformar sin runtime real de Expo). */

export const CADENCIA_REVALIDACION_DIAS_DEFAULT = 14;

/** ¿Ya pasó la cadencia de revalidación en línea? Se le pasa `ahora` para poder probarla sin
 *  depender del reloj real. `ultimaVerificacionIso === null` (nunca se ha revalidado desde que
 *  se adoptó el dispositivo) siempre cuenta como "necesita revalidación", pero esto NUNCA debe
 *  usarse para bloquear una venta — solo para mostrar un aviso no bloqueante la próxima vez que
 *  haya conexión (ver PosCajaScreen/indicador de sync, Fase 2a). */
export function necesitaRevalidacion(ultimaVerificacionIso: string | null, cadenciaDias: number, ahora: Date = new Date()): boolean {
  if (!ultimaVerificacionIso) return true;
  const ultima = new Date(ultimaVerificacionIso).getTime();
  const limiteMs = cadenciaDias * 24 * 60 * 60 * 1000;
  return ahora.getTime() - ultima >= limiteMs;
}
