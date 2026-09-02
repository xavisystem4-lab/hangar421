/**
 * Generador de UUID v7 (ordenable por tiempo) — usado por los clientes offline-first
 * para crear IDs localmente sin colisión y sin depender del servidor.
 * Implementación mínima sin dependencias externas.
 */
export function uuid7(): string {
  const now = Date.now();
  const timeHex = now.toString(16).padStart(12, "0");

  const rand = new Uint8Array(10);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(rand);
  } else {
    for (let i = 0; i < rand.length; i++) rand[i] = Math.floor(Math.random() * 256);
  }

  // version 7 en el nibble alto del 7º byte, variante RFC 4122 en el 9º byte
  rand[0] = (rand[0] & 0x0f) | 0x70;
  rand[2] = (rand[2] & 0x3f) | 0x80;

  const randHex = Array.from(rand, (b) => b.toString(16).padStart(2, "0")).join("");

  return [
    timeHex.slice(0, 8),
    timeHex.slice(8, 12),
    randHex.slice(0, 4),
    randHex.slice(4, 8),
    randHex.slice(8, 20),
  ].join("-");
}
