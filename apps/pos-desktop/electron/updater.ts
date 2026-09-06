import { app, BrowserWindow, ipcMain } from "electron";
import { autoUpdater } from "electron-updater";

/**
 * Auto-actualización (electron-updater) — feed de GitHub Releases del propio repo
 * (configurado en package.json > build.publish). Flujo: el footer del renderer dispara
 * "updater:verificar" -> si hay una versión nueva se descarga automáticamente mostrando
 * progreso -> al terminar, el usuario confirma "Reiniciar e instalar" (updater:instalar).
 * Todos los eventos se reenvían al renderer vía el canal "updater:evento".
 */
export function configurarAutoUpdater(obtenerVentana: () => BrowserWindow | null) {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // Sin empaquetar (`npm run dev`), electron-updater por defecto ni siquiera intenta
  // checkForUpdates() — falla con "app is not packaged" antes de disparar ningún evento, y el
  // footer se quedaba pegado en "Buscando actualizaciones…" para siempre (o, con el guard
  // anterior, mostraba directo un error genérico). `forceDevUpdateConfig` + `dev-app-update.yml`
  // (mismo `provider`/`owner`/`repo` que `package.json > build.publish`) es el mecanismo
  // documentado de electron-updater para probar el flujo real de actualización en desarrollo.
  //
  // OJO: esto solo puede encontrar un release real en una PC Windows (el único target que
  // publica este proyecto — ver package.json > build.win). Corriendo en cualquier otra
  // plataforma (ej. esta Mac de desarrollo) seguirá fallando, ahora con el propio error de
  // electron-updater ("no se encontró latest-mac.yml" o similar) en vez del mensaje genérico de
  // antes — no hay ningún artefacto de Mac publicado para encontrar.
  if (!app.isPackaged) {
    autoUpdater.forceDevUpdateConfig = true;
  }

  const emitir = (tipo: string, data?: unknown) => {
    obtenerVentana()?.webContents.send("updater:evento", { tipo, data });
  };

  autoUpdater.on("checking-for-update", () => emitir("verificando"));
  autoUpdater.on("update-available", (info) => emitir("disponible", { version: info.version }));
  autoUpdater.on("update-not-available", () => emitir("al-dia"));
  autoUpdater.on("download-progress", (progress) =>
    emitir("progreso", { porcentaje: Math.round(progress.percent), bps: progress.bytesPerSecond }),
  );
  autoUpdater.on("update-downloaded", (info) => emitir("descargada", { version: info.version }));
  autoUpdater.on("error", (err) => emitir("error", { mensaje: err.message }));

  ipcMain.handle("updater:verificar", async () => {
    try {
      await autoUpdater.checkForUpdates();
    } catch (e: any) {
      emitir("error", { mensaje: e.message });
    }
  });

  ipcMain.handle("updater:instalar", () => {
    autoUpdater.quitAndInstall();
  });

  ipcMain.handle("app:version", () => {
    // `app.getVersion()` solo es confiable en un build EMPAQUETADO (lee el "version" del
    // package.json que electron-builder incrusta en la app). Sin empaquetar (`npm run dev`)
    // puede caer en devolver la versión del propio runtime de Electron (ej. "32.3.3", la
    // versión de Electron instalada, no la de esta app) — un footgun conocido de Electron.
    // Se lee el package.json de este workspace directo para que el footer muestre la versión
    // real también en modo desarrollo.
    if (!app.isPackaged) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        return require("../package.json").version as string;
      } catch {
        // sigue al fallback de abajo si por algo no se pudo leer
      }
    }
    return app.getVersion();
  });
}
