import { app } from "electron";
import { spawn, ChildProcess } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as net from "net";
import * as http from "http";
import * as crypto from "crypto";

/**
 * Arranca el backend HANGAR 421 completo (NestJS + PostgreSQL embebido) dentro del propio
 * POS Windows, para que el instalador funcione "de una" sin necesitar un servidor separado
 * ni configuración manual. Todo vive en `app.getPath('userData')`, persiste entre reinicios,
 * y se apaga limpio al cerrar la app.
 *
 * Solo se usa en producción empaquetada (ver electron/main.ts) — en desarrollo se sigue
 * usando un backend corrido aparte (`npm run dev:backend`), igual que siempre.
 *
 * Todo paso que puede quedarse esperando indefinidamente (antivirus bloqueando un binario,
 * firewall pidiendo permiso en una ventana oculta, etc.) tiene un timeout explícito — nunca
 * debe dejar al usuario mirando la pantalla de arranque sin avisar. Cada paso además queda
 * en un log en disco (`local-data/arranque.log`) para poder diagnosticar sin depender de
 * capturas de pantalla si algo vuelve a fallar.
 */

interface Secretos {
  dbPassword: string;
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
}

export interface BackendEmbebido {
  url: string;
  detener: () => Promise<void>;
}

export async function iniciarBackendEmbebido(logIn: (msg: string) => void): Promise<BackendEmbebido> {
  const dataDir = path.join(app.getPath("userData"), "local-data");
  fs.mkdirSync(dataDir, { recursive: true });
  const logPath = path.join(dataDir, "arranque.log");

  const log = (msg: string) => {
    try {
      fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`);
    } catch {
      /* nunca bloquear el arranque por no poder escribir el log */
    }
    logIn(msg);
  };

  log(`=== Arrancando backend embebido — userData: ${app.getPath("userData")} ===`);

  const resourcesDir = obtenerDirectorioBackend();
  const nodeBin = obtenerBinarioNode(resourcesDir);
  verificarArchivosNecesarios(resourcesDir, nodeBin, log);

  // embedded-postgres se distribuye como ESM puro. tsc, al compilar a CommonJS, reescribe
  // cualquier `import()` dinámico de vuelta a un `require()` (que sí falla contra ESM puro) —
  // por eso se construye el import() en runtime con `new Function`, invisible para tsc, para
  // que quede como un import() nativo de verdad (Node sí puede cargar ESM así desde CJS).
  const importDinamico = new Function("especificador", "return import(especificador)") as (
    especificador: string,
  ) => Promise<{ default: new (opciones: Record<string, unknown>) => any }>;
  const { default: EmbeddedPostgres } = await importDinamico("embedded-postgres");

  const pgDataDir = path.join(dataDir, "pgdata");
  const secretos = obtenerOCrearSecretos(path.join(dataDir, "secrets.json"));
  const pgPort = await puertoLibre();

  const yaInicializado = fs.existsSync(path.join(pgDataDir, "PG_VERSION"));
  log(yaInicializado ? "Base de datos local existente — iniciando…" : "Primera vez — creando base de datos local…");

  const pg = new EmbeddedPostgres({
    databaseDir: pgDataDir,
    user: "hangar",
    password: secretos.dbPassword,
    port: pgPort,
    persistent: true,
    onLog: (msg: string) => log(`[postgres] ${msg}`),
    onError: (msg: string) => log(`[postgres] ${msg}`),
  });

  const mensajeTimeoutPg =
    "PostgreSQL local no respondió a tiempo. Esto casi siempre es el antivirus bloqueando o " +
    "escaneando los binarios (initdb.exe / postgres.exe) — revisa Windows Defender > Protección " +
    "contra virus y amenazas > Historial de protección, y agrega una exclusión para la carpeta " +
    "de instalación de HANGAR 421 POS si aparece algo puesto en cuarentena.";

  if (!yaInicializado) {
    log("Inicializando PostgreSQL (initdb)…");
    await conTimeout(pg.initialise(), 90_000, mensajeTimeoutPg);
  }
  log("Arrancando PostgreSQL…");
  await conTimeout(pg.start(), 45_000, mensajeTimeoutPg);
  if (!yaInicializado) {
    log("Creando base de datos hangar421…");
    await conTimeout(pg.createDatabase("hangar421"), 30_000, mensajeTimeoutPg);
  }

  const backendPort = await puertoLibre();

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    DATABASE_URL: `postgresql://hangar:${secretos.dbPassword}@127.0.0.1:${pgPort}/hangar421?schema=public`,
    JWT_ACCESS_SECRET: secretos.jwtAccessSecret,
    JWT_REFRESH_SECRET: secretos.jwtRefreshSecret,
    JWT_ACCESS_EXPIRES_IN: "15m",
    JWT_REFRESH_EXPIRES_IN: "30d",
    PORT: String(backendPort),
    API_PREFIX: "api/v1",
    CORS_ORIGINS: "*",
    AUTO_BOOTSTRAP: "true",
    BACKEND_PRISMA_DIR: path.join(resourcesDir, "prisma"),
  };

  log(`Iniciando backend local (${nodeBin})…`);
  const proceso = spawn(nodeBin, [path.join(resourcesDir, "dist", "main.js")], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  proceso.stdout?.on("data", (d) => log(`[backend] ${String(d).trim()}`));
  proceso.stderr?.on("data", (d) => log(`[backend] ${String(d).trim()}`));
  proceso.on("exit", (code) => log(`[backend] proceso terminado (código ${code})`));
  proceso.on("error", (e) => log(`[backend] error al lanzar el proceso: ${e.message}`));

  const url = `http://127.0.0.1:${backendPort}`;
  await esperarSalud(url, proceso, log);
  log(`Backend local listo en ${url}`);

  return {
    url,
    detener: () => detener(proceso, pg, log),
  };
}

async function detener(proceso: ChildProcess, pg: any, log: (msg: string) => void): Promise<void> {
  log("Deteniendo backend local…");
  await new Promise<void>((resolve) => {
    if (!proceso.pid || proceso.exitCode !== null) return resolve();
    proceso.once("exit", () => resolve());
    proceso.kill();
    setTimeout(resolve, 5000); // no bloquear el cierre de la app indefinidamente
  });
  await pg.stop().catch((e: Error) => log(`[postgres] error al detener: ${e.message}`));
}

function obtenerDirectorioBackend(): string {
  // process.resourcesPath -> .../HANGAR 421 POS/resources ; ahí electron-builder copia
  // extraResources "backend" (dist + prisma + node_modules + node.exe, ver package.json > build).
  return path.join(process.resourcesPath, "backend");
}

function obtenerBinarioNode(resourcesDir: string): string {
  const nombre = process.platform === "win32" ? "node.exe" : "node";
  return path.join(resourcesDir, "node", nombre);
}

/** Falla rápido y claro si falta algún archivo necesario, en vez de dejar que el intento de
 *  arrancar Postgres/el backend se quede esperando en silencio (lo que pasaba antes: si el
 *  antivirus borraba/ponía en cuarentena los binarios, la app se quedaba congelada sin avisar
 *  y no aparecía ningún proceso en el Administrador de tareas). */
function verificarArchivosNecesarios(resourcesDir: string, nodeBin: string, log: (msg: string) => void) {
  const faltantes: string[] = [];

  if (!fs.existsSync(nodeBin)) faltantes.push(`binario de Node (${nodeBin})`);
  if (!fs.existsSync(path.join(resourcesDir, "dist", "main.js"))) {
    faltantes.push(`backend compilado (${path.join(resourcesDir, "dist", "main.js")})`);
  }

  const appNodeModules = path.join(__dirname, "..", "node_modules");
  const embeddedPgScope = path.join(appNodeModules, "@embedded-postgres");
  const tieneBinariosPg = fs.existsSync(embeddedPgScope) && fs.readdirSync(embeddedPgScope).length > 0;
  if (!tieneBinariosPg) faltantes.push(`binarios de PostgreSQL (${embeddedPgScope})`);

  log(`Verificación de archivos: node=${fs.existsSync(nodeBin)} backend=${fs.existsSync(path.join(resourcesDir, "dist", "main.js"))} postgres=${tieneBinariosPg}`);

  if (faltantes.length > 0) {
    throw new Error(
      `Faltan archivos necesarios para el backend local — probablemente el antivirus los ` +
        `bloqueó o eliminó. Revisa Windows Defender > Protección contra virus y amenazas > ` +
        `Historial de protección, restaura lo puesto en cuarentena y agrega una exclusión para ` +
        `la carpeta de instalación. Archivos faltantes: ${faltantes.join("; ")}`,
    );
  }
}

async function puertoLibre(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address ? address.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function conTimeout<T>(promesa: Promise<T>, ms: number, mensaje: string): Promise<T> {
  return Promise.race([
    promesa,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(mensaje)), ms)),
  ]);
}

function esperarSalud(url: string, proceso: ChildProcess, log: (msg: string) => void, intentos = 60): Promise<void> {
  return new Promise((resolve, reject) => {
    let restantes = intentos;
    const intentar = () => {
      if (proceso.exitCode !== null) {
        reject(new Error(`El backend local terminó antes de iniciar (código ${proceso.exitCode})`));
        return;
      }
      http
        .get(`${url}/api/v1/health`, (res) => {
          if (res.statusCode === 200) resolve();
          else reintentar();
        })
        .on("error", reintentar);
    };
    const reintentar = () => {
      restantes -= 1;
      if (restantes <= 0) {
        reject(new Error("El backend local no respondió a tiempo (30s) — revisa el log en local-data/arranque.log"));
        return;
      }
      setTimeout(intentar, 500);
    };
    intentar();
  });
}

function obtenerOCrearSecretos(rutaArchivo: string): Secretos {
  if (fs.existsSync(rutaArchivo)) {
    return JSON.parse(fs.readFileSync(rutaArchivo, "utf-8"));
  }
  const secretos: Secretos = {
    dbPassword: crypto.randomBytes(24).toString("hex"),
    jwtAccessSecret: crypto.randomBytes(48).toString("hex"),
    jwtRefreshSecret: crypto.randomBytes(48).toString("hex"),
  };
  fs.writeFileSync(rutaArchivo, JSON.stringify(secretos, null, 2), { mode: 0o600 });
  return secretos;
}
