import { app, BrowserWindow, ipcMain } from "electron";
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

const isDev = process.env.NODE_ENV === "development";
let ventanaPrincipal: BrowserWindow | null = null;

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
}
