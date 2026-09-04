import { app, BrowserWindow, ipcMain, Menu } from "electron";
import * as path from "path";
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

  backendEmbebido = await iniciarBackendEmbebido(log);
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
}
