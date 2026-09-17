/** Token de inyección de dependencias para la instancia de CifradoService específica del dominio
 *  "plataformas" (llave propia PLATAFORMAS_CIFRADO_KEY, distinta de la de pagos — ver
 *  plataformas.module.ts y common/crypto/cifrado.service.ts). */
export const CIFRADO_PLATAFORMAS = Symbol("CIFRADO_PLATAFORMAS");
