// Doble de expo-crypto para Jest: el módulo real es nativo y no carga fuera del runtime de Expo.
// Se usa el crypto de Node, así que el SHA-256 es el mismo algoritmo real — las pruebas de
// autorización comprueban de verdad que un PIN incorrecto no produce el hash correcto, no un
// stub que siempre devuelva lo mismo.
const nodeCrypto = require("crypto");

const CryptoDigestAlgorithm = { SHA256: "SHA-256" };

async function getRandomBytesAsync(n) {
  return new Uint8Array(nodeCrypto.randomBytes(n));
}

async function digestStringAsync(_algoritmo, texto) {
  return nodeCrypto.createHash("sha256").update(texto).digest("hex");
}

module.exports = { CryptoDigestAlgorithm, getRandomBytesAsync, digestStringAsync };
