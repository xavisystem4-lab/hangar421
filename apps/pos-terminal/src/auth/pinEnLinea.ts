/**
 * Entrada con PIN cuando el usuario viene del ERP: con red manda el ERP, sin red manda la tablet.
 *
 * Antes la tablet solo comparaba contra su copia local del PIN, así que cambiar un PIN en el ERP
 * no servía de nada: el PIN viejo seguía entrando. Con el PIN personal (dos personas ya no pueden
 * compartirlo), ahora el PIN nuevo entra en cuanto haya red, y el viejo deja de servir.
 */
export type RespuestaErpPin = "ok" | "rechazado" | "sin-red";
export type DecisionLogin = "entrar-con-erp" | "entrar-local" | "rechazar" | "pin-cambio";

export function decidirLogin(pinLocalValido: boolean, erp: RespuestaErpPin): DecisionLogin {
  if (erp === "ok") return "entrar-con-erp";
  if (erp === "rechazado") return pinLocalValido ? "pin-cambio" : "rechazar";
  return pinLocalValido ? "entrar-local" : "rechazar";
}

/** Cuánto se espera al ERP antes de seguir sin red: entrar no puede quedarse colgado. */
export const ESPERA_ERP_LOGIN_MS = 4000;
