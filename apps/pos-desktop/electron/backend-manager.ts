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
  /** Puerto en el que escucha el backend embebido — se usa para armar el dato de conexión que
   *  se le muestra al admin en pantalla (ver electron/main.ts, IPC "backend:obtenerInfoConexion")
   *  para que lo capture en el módulo de conexión de la app de Meseros. */
  puerto: number;
  detener: () => Promise<void>;
}

export async function iniciarBackendEmbebido(logIn: (msg: string) => void, puertoPreferido = 3000): Promise<BackendEmbebido> {
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
  ) => Promise<any>;
  const { default: EmbeddedPostgres } = await importDinamico("embedded-postgres");
  const pgCtlPath = await resolverPgCtl(importDinamico, log);

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
  limpiarLockStaleSiCorresponde(pgDataDir, log);
  log("Arrancando PostgreSQL…");
  // embedded-postgres rechaza esta promesa sin ningún Error (`reject()` a secas) si el proceso
  // de Postgres se cierra antes de terminar de arrancar — normalizamos acá para no propagar un
  // rechazo `undefined` que rompería el `.catch` de más arriba con un TypeError críptico. El
  // motivo real de por qué Postgres se cerró queda igual en el log, arriba de este mensaje
  // (viene del `onLog`/`onError` de embedded-postgres con la salida de postgres.exe).
  await conTimeout(pg.start(), 45_000, mensajeTimeoutPg).catch((e) => {
    if (e instanceof Error) throw e;
    throw new Error(
      "PostgreSQL local se cerró inesperadamente al arrancar. Revisa las líneas [postgres] " +
        "justo arriba de esta en local-data/arranque.log para ver el motivo exacto (puerto " +
        "ocupado, datos corruptos, antivirus bloqueando postgres.exe, etc.).",
    );
  });
  if (!yaInicializado) {
    log("Creando base de datos hangar421…");
    await conTimeout(pg.createDatabase("hangar421"), 30_000, mensajeTimeoutPg);
  }

  // Puerto FIJO (3000 salvo que el admin haya guardado otra preferencia — ver
  // "Conexión Meseros"/main.ts) siempre que esté libre — antes se elegía uno al azar en cada
  // arranque, lo que dejaba a la app de Meseros sin forma de saber a qué puerto conectarse sin
  // volver a mirar la PC cada vez que se reiniciaba el POS. Con un puerto fijo, la IP:puerto que
  // se le muestra al admin se mantiene estable entre reinicios — solo cambia si ese puerto ya
  // estaba ocupado por otra cosa (cae a uno al azar) o si el admin guardó uno distinto a mano.
  const backendPort = await puertoPreferidoOLibre(puertoPreferido);

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
    puerto: backendPort,
    detener: () => detener(proceso, pg, pgCtlPath, pgDataDir, log),
  };
}

async function detener(
  proceso: ChildProcess,
  pg: any,
  pgCtlPath: string | null,
  pgDataDir: string,
  log: (msg: string) => void,
): Promise<void> {
  log("Deteniendo backend local…");
  await new Promise<void>((resolve) => {
    if (!proceso.pid || proceso.exitCode !== null) return resolve();
    proceso.once("exit", () => resolve());
    proceso.kill();
    setTimeout(resolve, 5000); // no bloquear el cierre de la app indefinidamente
  });

  // embedded-postgres, en Windows, detiene Postgres con `taskkill /pid <pid> /f /t` — un
  // TerminateProcess forzado de TODO el árbol de procesos (postmaster + checkpointer +
  // background writer + WAL writer), sin darle a Postgres oportunidad de un apagado limpio.
  // Confirmado en producción vía local-data/arranque.log: el checkpointer termina con código de
  // error (no 0) en vez de salir limpio, y el siguiente arranque encuentra un bloque de memoria
  // compartida de Windows "todavía en uso" (FATAL: pre-existing shared memory block is still in
  // use) aunque el proceso dueño ya no exista — Windows no siempre libera esa memoria de
  // inmediato tras un TerminateProcess de todo el árbol. `pg_ctl stop -m fast` es el mecanismo
  // correcto y soportado por Postgres para un apagado limpio en cualquier plataforma (internamente
  // sabe cómo pedirle a Postgres que cierre bien en Windows, a diferencia de un taskkill crudo).
  // Si no se pudo resolver `pg_ctl` o no respondió a tiempo, se cae al método de la librería como
  // último recurso — nunca debe dejar el cierre de la app colgado indefinidamente.
  const detenidoLimpio = pgCtlPath ? await detenerConPgCtl(pgCtlPath, pgDataDir, log) : false;
  if (!detenidoLimpio) {
    await pg.stop().catch((e: Error) => log(`[postgres] error al detener: ${e.message}`));
  }
}

function detenerConPgCtl(pgCtlPath: string, pgDataDir: string, log: (msg: string) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(pgCtlPath, ["stop", "-D", pgDataDir, "-m", "fast", "-w", "-t", "20"], { windowsHide: true });
    let salida = "";
    proc.stdout?.on("data", (d) => (salida += String(d)));
    proc.stderr?.on("data", (d) => (salida += String(d)));
    const limite = setTimeout(() => {
      log("[postgres] pg_ctl stop no respondió en 22s — se cae al método de respaldo");
      resolve(false);
    }, 22_000);
    proc.on("exit", (code) => {
      clearTimeout(limite);
      if (salida.trim()) log(`[postgres] pg_ctl stop: ${salida.trim()}`);
      resolve(code === 0);
    });
    proc.on("error", (e) => {
      clearTimeout(limite);
      log(`[postgres] no se pudo ejecutar pg_ctl stop (${e.message}) — se cae al método de respaldo`);
      resolve(false);
    });
  });
}

/** Resuelve el binario `pg_ctl` del mismo paquete de binarios (`@embedded-postgres/<plataforma>`)
 *  que ya usa la librería internamente — cada paquete de plataforma lo exporta directo (ver, en
 *  node_modules, el archivo "dist/index.js" de cualquier paquete @embedded-postgres: contiene
 *  `export const pg_ctl = ...`), así que no hace falta adivinar la ruta a mano. Devuelve `null`
 *  si la plataforma no tiene un paquete de binarios conocido (no debería pasar en producción —
 *  el POS solo se distribuye para Windows). */
async function resolverPgCtl(
  importDinamico: (especificador: string) => Promise<any>,
  log: (msg: string) => void,
): Promise<string | null> {
  const paquete = paqueteDeBinariosPg();
  if (!paquete) {
    log("[postgres] plataforma sin paquete de binarios conocido para pg_ctl — se usará el método de respaldo al detener");
    return null;
  }
  try {
    const mod = await importDinamico(paquete);
    return typeof mod.pg_ctl === "string" ? mod.pg_ctl : null;
  } catch (e: any) {
    log(`[postgres] no se pudo resolver pg_ctl (${e.message}) — se usará el método de respaldo al detener`);
    return null;
  }
}

function paqueteDeBinariosPg(): string | null {
  const arch = process.arch;
  switch (process.platform) {
    case "darwin":
      return arch === "arm64" ? "@embedded-postgres/darwin-arm64" : arch === "x64" ? "@embedded-postgres/darwin-x64" : null;
    case "win32":
      return arch === "x64" ? "@embedded-postgres/windows-x64" : null;
    case "linux":
      switch (arch) {
        case "arm64": return "@embedded-postgres/linux-arm64";
        case "arm": return "@embedded-postgres/linux-arm";
        case "ia32": return "@embedded-postgres/linux-ia32";
        case "ppc64": return "@embedded-postgres/linux-ppc64";
        case "x64": return "@embedded-postgres/linux-x64";
        default: return null;
      }
    default:
      return null;
  }
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

/** Si Postgres se apagó de forma abrupta (la app cerrada a la fuerza desde el Administrador de
 *  tareas, una VM apagada/revertida sin pasar por Windows, un corte de luz) el `before-quit` de
 *  main.ts nunca llega a correr `pg.stop()`, así que puede quedar un `postmaster.pid` en el
 *  directorio de datos apuntando a un proceso que ya no existe. Postgres, sobre todo en Windows,
 *  no siempre distingue bien ese caso de uno donde SÍ hay otro Postgres corriendo contra los
 *  mismos datos, y puede negarse a arrancar con justo el error "se cerró inesperadamente al
 *  arrancar" que este cambio busca evitar. Se borra el lock SOLO si el PID que contiene ya no
 *  corresponde a ningún proceso vivo — si sigue vivo, se deja intacto a propósito (evita correr
 *  dos Postgres embebidos a la vez contra la misma carpeta, lo que sí corrompería datos). */
function limpiarLockStaleSiCorresponde(pgDataDir: string, log: (msg: string) => void) {
  const lockPath = path.join(pgDataDir, "postmaster.pid");
  if (!fs.existsSync(lockPath)) return;
  try {
    const pid = parseInt(fs.readFileSync(lockPath, "utf-8").split("\n")[0], 10);
    if (!Number.isFinite(pid)) return;
    if (procesoEnEjecucion(pid)) {
      log(`[postgres] postmaster.pid apunta a un proceso todavía activo (pid ${pid}) — no se toca.`);
      return;
    }
    log(`[postgres] postmaster.pid quedó de un cierre abrupto anterior (pid ${pid} ya no existe) — se borra para permitir un arranque limpio.`);
    fs.unlinkSync(lockPath);
  } catch (e: any) {
    log(`[postgres] no se pudo revisar postmaster.pid: ${e.message}`);
  }
}

/** `process.kill(pid, 0)` no envía ninguna señal real — solo comprueba si el proceso existe
 *  (lanza ESRCH/EPERM si no). Funciona igual en Windows (Node lo emula) que en macOS/Linux. */
function procesoEnEjecucion(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
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

/** Igual que `puertoLibre()`, pero intenta primero el puerto `preferido` (sin host — igual que
 *  `app.listen(port)` en apps/backend/src/main.ts, así que la prueba de disponibilidad es sobre
 *  todas las interfaces, no solo loopback) y solo cae a uno al azar si ese ya está ocupado. */
async function puertoPreferidoOLibre(preferido: number): Promise<number> {
  const libre = await new Promise<boolean>((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", () => resolve(false));
    srv.listen(preferido, () => srv.close(() => resolve(true)));
  });
  return libre ? preferido : puertoLibre();
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
