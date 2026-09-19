// Ayudante temporal de desarrollo: levanta un Postgres embebido (mismo paquete `embedded-postgres`
// que ya usa apps/pos-desktop para el POS standalone) cuando no hay Docker ni un Postgres local
// instalado en la máquina. Uso: node scripts/dev-embedded-pg.mjs
import EmbeddedPostgres from "embedded-postgres";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const databaseDir = path.join(__dirname, "..", ".dev-pgdata");

const pg = new EmbeddedPostgres({
  databaseDir,
  user: "admin",
  password: "hangar_dev_pw",
  port: 5432,
  persistent: true,
});

const yaInicializado = fs.existsSync(path.join(databaseDir, "PG_VERSION"));

if (!yaInicializado) {
  console.log("Inicializando cluster Postgres embebido en", databaseDir, "...");
  await pg.initialise();
}

console.log("Arrancando Postgres embebido en el puerto 5432...");
await pg.start();

try {
  await pg.createDatabase("hangar421_dev");
  console.log('Base de datos "hangar421_dev" creada.');
} catch (e) {
  console.log('Base de datos "hangar421_dev" ya existía, se reutiliza.');
}

console.log("Postgres embebido listo (Ctrl+C para detenerlo).");

process.on("SIGINT", async () => {
  await pg.stop();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await pg.stop();
  process.exit(0);
});

// Mantener el proceso vivo indefinidamente.
await new Promise(() => {});
