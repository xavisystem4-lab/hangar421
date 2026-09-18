/** Decodifica el payload de un JWT sin `atob` (no siempre disponible en Hermes/RN) — mismo
 *  código que apps/waiter-mobile/src/store/authStore.ts, duplicado a propósito: es una utilidad
 *  de 15 líneas sin estado, no vale la pena una dependencia compartida solo por esto. */
export function decodificarJwt<T = Record<string, unknown>>(token: string): T {
  const [, payloadB64] = token.split(".");
  const normalizado = payloadB64.replace(/-/g, "+").replace(/_/g, "/").padEnd(payloadB64.length + ((4 - (payloadB64.length % 4)) % 4), "=");
  const binario = base64Decode(normalizado);
  return JSON.parse(binario);
}

const ALFABETO_B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64Decode(input: string): string {
  let salida = "";
  let buffer = 0;
  let bits = 0;
  for (const char of input.replace(/=+$/, "")) {
    buffer = (buffer << 6) | ALFABETO_B64.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      salida += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return decodeURIComponent(
    salida
      .split("")
      .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
      .join(""),
  );
}
