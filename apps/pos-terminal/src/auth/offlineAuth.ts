import * as Crypto from "expo-crypto";

/** Autenticación offline — ver Decisión #3 del plan de separación de Punto de Venta: nunca se
 *  guarda el hash bcrypt real del servidor ni el PIN en texto plano, solo un hash local salado
 *  derivado de un PIN que ya se validó (en línea, o localmente antes) — no es portable a otro
 *  dispositivo ni comparable contra el hash del servidor. Es un compromiso de seguridad
 *  deliberado y documentado, aceptado explícitamente por el negocio: ver el plan para el
 *  razonamiento completo.
 *
 *  La lógica pura (cadencia de revalidación) vive aparte, en revalidacion.ts, para poder
 *  probarse bajo Jest sin arrastrar este import de expo-crypto (módulo nativo). */

const ALGORITMO = "sha256-v1" as const;

function bytesAHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function generarSalt(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(16);
  return bytesAHex(bytes);
}

export async function derivarHashPin(pin: string, salt: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${pin}`);
}

export { ALGORITMO as algoritmoHashActual };
export { necesitaRevalidacion, CADENCIA_REVALIDACION_DIAS_DEFAULT } from "./revalidacion";
