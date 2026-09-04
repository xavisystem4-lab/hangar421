import { app, BrowserWindow, ipcMain, Menu } from "electron";
import * as path from "path";
import * as os from "os";
import {
  iniciarBaseDeDatos,
  obtenerDeviceId,
  encolarOperacion,
  outboxPendiente,
  marcarSincronizado,
  marcarError,
  contarPendientes,
  guardarEnCache,
  listarCache,
  obtenerConfig,
  guardarConfig,
} from "./db";
import { configurarAutoUpdater } from "./updater";
import { iniciarBackendEmbebido, BackendEmbebido } from "./backend-manager";

const isDev = process.env.NODE_ENV === "development";
let ventanaPrincipal: BrowserWindow | null = null;
let backendEmbebido: BackendEmbebido | null = null;

// Overrides guardados desde Administración → "Conexión Meseros" (config local, ver db.ts) —
// mismo mecanismo genérico que ya usa "config:guardar"/"config:obtener" para otras preferencias.
// Se agregaron porque la detección automática de IP puede equivocarse (ver obtenerIpLan) y el
// puerto real puede no ser 3000 si algo más ya lo ocupaba al arrancar — sin esto, el admin no
// tenía forma de corregirlo a mano cuando eso pasaba.
const CLAVE_IP = "conexion_meseros_ip_manual";
const CLAVE_PUERTO = "conexion_meseros_puerto_preferido";

// El backend embebido (electron/backend-manager.ts) tiene su propio watchdog interno de
// unhandled rejections en Node; embedded-postgres además dispara alguna advertencia interna
// al detenerse dos veces seguidas — se registra sin tumbar la app (nunca es un error del
// backend real, ya validado con pruebas end-to-end).
process.on("unhandledRejection", (reason) => {
  console.error("[main] unhandledRejection:", reason);
});

/** Resuelve la URL del backend a usar:
 *  - Si HANGAR_CLOUD_API_URL está configurada (deployment cloud real, multisucursal), se usa esa.
 *  - Si no, y estamos empaquetados (producción), se levanta el backend + Postgres embebidos.
 *  - En desarrollo, no se levanta nada aquí — se usa el backend corrido aparte (`npm run dev:backend`),
 *    el renderer cae a VITE_API_URL (localhost:3000 por defecto). */
async function resolverBackend(log: (msg: string) => void): Promise<string | null> {
  const cloudUrl = process.env.HANGAR_CLOUD_API_URL;
  if (cloudUrl) {
    log(`Usando backend cloud configurado: ${cloudUrl}`);
    return cloudUrl;
  }
  if (isDev) return null;

  // Puerto preferido: el que se haya guardado desde Administración → "Conexión Meseros" (ver
  // CLAVE_PUERTO más abajo), o 3000 si nunca se tocó ese campo. Solo aplica en el PRÓXIMO
  // arranque del backend — no se puede recolocar un puerto ya bindeado mientras la app corre.
  const guardado = Number(obtenerConfig(CLAVE_PUERTO));
  const puertoPreferido = Number.isInteger(guardado) && guardado > 0 && guardado <= 65535 ? guardado : 3000;

  backendEmbebido = await iniciarBackendEmbebido(log, puertoPreferido);
  return backendEmbebido.url;
}

function crearVentana() {
  const win = new BrowserWindow({
    width: 1366,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: "HANGAR 421 POS",
    backgroundColor: "#111318",
    icon: path.join(__dirname, "../build/icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    win.loadURL("http://localhost:5173");
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  win.on("closed", () => {
    if (ventanaPrincipal === win) ventanaPrincipal = null;
  });
  ventanaPrincipal = win;
}

app.whenReady().then(() => {
  // Sin la barra de menú genérica de Electron (File/Edit/View/Window/Help) — no aporta nada
  // en un POS táctil, y la navegación real vive en la barra superior propia de la app.
  Menu.setApplicationMenu(null);

  iniciarBaseDeDatos();
  registrarIpc();
  configurarAutoUpdater(() => ventanaPrincipal);
  crearVentana();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) crearVentana();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Apagar limpio el backend/Postgres embebidos antes de salir (evita dejar el proceso
// de Postgres huérfano o corromper datos por un corte abrupto).
let apagando = false;
app.on("before-quit", async (event) => {
  if (!backendEmbebido || apagando) return;
  apagando = true;
  event.preventDefault();
  await backendEmbebido.detener().catch((e) => console.error("[main] error al detener backend:", e));
  backendEmbebido = null;
  app.quit();
});

function registrarIpc() {
  ipcMain.handle("device:id", () => obtenerDeviceId());

  ipcMain.handle("outbox:encolar", (_e, item) => encolarOperacion(item));
  ipcMain.handle("outbox:pendientes", (_e, limite) => outboxPendiente(limite));
  ipcMain.handle("outbox:marcarSincronizado", (_e, localId) => marcarSincronizado(localId));
  ipcMain.handle("outbox:marcarError", (_e, localId, error) => marcarError(localId, error));
  ipcMain.handle("outbox:contarPendientes", () => contarPendientes());

  ipcMain.handle("cache:guardar", (_e, coleccion, id, data) => guardarEnCache(coleccion, id, data));
  ipcMain.handle("cache:listar", (_e, coleccion) => listarCache(coleccion));

  ipcMain.handle("config:obtener", (_e, clave) => obtenerConfig(clave));
  ipcMain.handle("config:guardar", (_e, clave, valor) => guardarConfig(clave, valor));

  // El backend embebido puede tardar unos segundos en arrancar la primera vez (crea la base
  // de datos local). El renderer llama esto al inicio y espera — ver src/App.tsx.
  let backendPromise: Promise<string | null> | null = null;
  ipcMain.handle("backend:obtenerUrl", (event) => {
    if (!backendPromise) {
      const enviarEstado = (msg: string) => event.sender.send("backend:estado", msg);
      backendPromise = resolverBackend(enviarEstado).catch((e) => {
        // Algunas dependencias (embedded-postgres) rechazan sin un Error real (p. ej. `reject()`
        // a secas si Postgres se cierra apenas arranca) — sin este resguardo, `e.message` explota
        // con un TypeError que tapa el error real y deja la pantalla de arranque sin explicación.
        const error = e instanceof Error ? e : new Error(String(e ?? "Error desconocido al iniciar el backend local"));
        enviarEstado(`Error: ${error.message}`);
        backendPromise = null; // permitir reintentar
        throw error;
      });
    }
    return backendPromise;
  });

  // Dato de conexión para la app de Meseros (ver ConexionScreen.tsx en apps/waiter-mobile): la
  // IP LAN de esta PC + el puerto del backend embebido. Solo tiene sentido cuando el backend
  // corre embebido en esta PC (no en modo cloud, donde el mesero se conecta a la URL en la nube
  // directamente) — por eso se lee `backendEmbebido` recién después de que "backend:obtenerUrl"
  // resolvió, y se devuelve null si esta instalación usa un backend cloud configurado.
  //
  // `ip`: si el admin guardó una manual (porque la detección automática se equivocó — ver
  // obtenerIpLan), esa gana; si no, se usa la detectada. `puerto`: siempre el REAL en el que el
  // backend ya está escuchando ahora mismo (`backendEmbebido.puerto`) — nunca un valor inventado,
  // aunque haya un "puerto preferido" guardado (ese solo aplica en el próximo arranque, ver
  // resolverBackend). `puertoPreferido` viaja aparte para que la pantalla pueda mostrar/editar
  // la preferencia sin confundirla con el puerto real actual.
  ipcMain.handle("backend:obtenerInfoConexion", () => {
    if (!backendEmbebido) return { ip: null, puerto: null, puertoPreferido: null };
    const ipManual = obtenerConfig(CLAVE_IP);
    const puertoPreferido = Number(obtenerConfig(CLAVE_PUERTO)) || 3000;
    return { ip: ipManual || obtenerIpLan(), puerto: backendEmbebido.puerto, puertoPreferido };
  });

  // Guarda los overrides manuales — ip vacía o puerto <=0 borra ese override (vuelve a
  // automático/3000). El puerto preferido solo toma efecto en el próximo arranque del backend;
  // se lo advierte al admin en la propia pantalla (AdminConexion.tsx).
  ipcMain.handle("backend:guardarInfoConexion", (_e, ip: string, puertoPreferido: number) => {
    guardarConfig(CLAVE_IP, ip?.trim() ?? "");
    guardarConfig(CLAVE_PUERTO, puertoPreferido > 0 ? String(puertoPreferido) : "");
  });
}

/** true si `ip` cae en un rango privado RFC1918 (192.168.0.0/16, 10.0.0.0/8, 172.16.0.0/12) —
 *  el rango que de verdad usa una red Wi-Fi/Ethernet doméstica u ofimática. */
function esPrivadaRfc1918(ip: string): boolean {
  const partes = ip.split(".").map(Number);
  if (partes.length !== 4 || partes.some((p) => Number.isNaN(p))) return false;
  const [a, b] = partes;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** Mejor intento de adivinar la IP de esta PC en la red local (Wi-Fi/Ethernet) — la misma que
 *  necesita un dispositivo en la misma red (tablet de mesero) para llegar a esta PC. Descarta
 *  loopback e IPv6, y filtra nombres de adaptador virtuales típicos (VPN, VirtualBox, Docker,
 *  Hyper-V) — pero ese filtro por NOMBRE no es suficiente: en producción un adaptador de VPN
 *  (Radmin VPN, Hamachi, etc.) con un nombre "normal" que no matcheaba el filtro devolvió una IP
 *  tipo 26.x.x.x en vez de la 192.168.x.x real, y la tablet nunca pudo conectar con eso. Por eso
 *  ahora se PREFIERE explícitamente cualquier candidata que sea una IP privada real (RFC1918) —
 *  casi siempre es la única forma correcta de saber cuál de varios adaptadores es "la red del
 *  local" — y solo se cae a la primera candidata cualquiera si ninguna lo es. */
function obtenerIpLan(): string | null {
  const interfaces = os.networkInterfaces();
  const IGNORAR = /virtual|vmware|virtualbox|docker|hyper-v|vethernet|tailscale|zerotier|radmin|hamachi|vpn|tun\d|tap\d/i;
  const candidatas: string[] = [];
  for (const [nombre, direcciones] of Object.entries(interfaces)) {
    if (IGNORAR.test(nombre) || !direcciones) continue;
    for (const dir of direcciones) {
      if (dir.family === "IPv4" && !dir.internal) candidatas.push(dir.address);
    }
  }
  return candidatas.find(esPrivadaRfc1918) ?? candidatas[0] ?? null;
}
