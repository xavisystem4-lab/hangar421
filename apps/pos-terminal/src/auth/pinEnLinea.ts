/**
 * Entrada con PIN. La copia LOCAL manda: si el PIN coincide con el guardado en esta tablet, se
 * entra siempre, con o sin red. Solo cuando el PIN local NO coincide se pregunta al ERP: si allá
 * es correcto (un PIN nuevo puesto en el ERP), se entra y se guarda en la tablet.
 *
 * Antes (APK 0.1.69) un rechazo del ERP dejaba fuera a quien tenía bien su PIN local ("Tu PIN
 * cambió en el ERP"). Con las baristas dadas de alta en la tablet —sin PIN en el ERP— eso detuvo
 * la operación. Ahora el ERP solo puede AYUDAR a entrar, nunca impedirlo.
 */
export type RespuestaErpPin = "ok" | "rechazado" | "sin-red";
export type DecisionLogin = "entrar-con-erp" | "entrar-local" | "rechazar";

/** ¿Hace falta preguntar al ERP? Solo si el PIN local no coincide (y el usuario viene del ERP). */
export function consultarErp(pinLocalValido: boolean, tieneUsuarioErp: boolean): boolean {
  return !pinLocalValido && tieneUsuarioErp;
}

export function decidirLogin(pinLocalValido: boolean, erp: RespuestaErpPin): DecisionLogin {
  if (pinLocalValido) return "entrar-local";
  return erp === "ok" ? "entrar-con-erp" : "rechazar";
}

/** Cuánto se espera al ERP antes de seguir sin red: entrar no puede quedarse colgado. */
export const ESPERA_ERP_LOGIN_MS = 4000;
