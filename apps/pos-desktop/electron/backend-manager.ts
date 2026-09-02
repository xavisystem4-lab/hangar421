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

export async function iniciarBackendEmbebido(log: (msg: string) => void): Promise<BackendEmbebido> {
  // embedded-postgres se distribuye como ESM puro. tsc, al compilar a CommonJS, reescribe
  // cualquier `import()` dinámico de vuelta a un `require()` (que sí falla contra ESM puro) —
  // por eso se construye el import() en runtime con `new Function`, invisible para tsc, para
  // que quede como un import() nativo de verdad (Node sí puede cargar ESM así desde CJS).
  const importDinamico = new Function("especificador", "return import(especificador)") as (
    especificador: string,
  ) => Promise<{ default: new (opciones: Record<string, unknown>) => any }>;
  const { default: EmbeddedPostgres } = await importDinamico("embedded-postgres");

  const dataDir = path.join(app.getPath("userData"), "local-data");
  const pgDataDir = path.join(dataDir, "pgdata");
  fs.mkdirSync(dataDir, { recursive: true });

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

  if (!yaInicializado) {
    await pg.initialise();
  }
  await pg.start();
  if (!yaInicializado) {
    await pg.createDatabase("hangar421");
  }

  const backendPort = await puertoLibre();
  const resourcesDir = obtenerDirectorioBackend();
  const nodeBin = obtenerBinarioNode(resourcesDir);

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

  log("Iniciando backend local…");
  const proceso = spawn(nodeBin, [path.join(resourcesDir, "dist", "main.js")], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  proceso.stdout?.on("data", (d) => log(`[backend] ${String(d).trim()}`));
  proceso.stderr?.on("data", (d) => log(`[backend] ${String(d).trim()}`));
  proceso.on("exit", (code) => log(`[backend] proceso terminado (código ${code})`));

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
  const bundled = path.join(resourcesDir, "node", nombre);
  if (fs.existsSync(bundled)) return bundled;
  // Fallback (no debería usarse en el instalador real, solo por si falta el empaquetado):
  return nombre;
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
        reject(new Error("El backend local no respondió a tiempo"));
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
