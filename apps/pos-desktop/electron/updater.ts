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
    // electron-updater necesita un build EMPAQUETADO (app.isPackaged) — el feed de GitHub
    // Releases solo trae artefactos de Windows (NSIS), así que en una app sin empaquetar
    // corriendo en cualquier plataforma (`npm run dev`, incluida una Mac de prueba)
    // `checkForUpdates()` no dispara ningún evento y el footer se queda pegado en "Buscando
    // actualizaciones…" para siempre. Se corta acá con un mensaje claro en vez de dejarlo
    // colgado — en producción (PC Windows con el .exe instalado) `isPackaged` siempre es true,
    // así que este guard nunca aplica ahí.
    if (!app.isPackaged) {
      emitir("error", { mensaje: "La auto-actualización no está disponible en modo desarrollo." });
      return;
    }
    try {
      await autoUpdater.checkForUpdates();
    } catch (e: any) {
      emitir("error", { mensaje: e.message });
    }
  });

  ipcMain.handle("updater:instalar", () => {
    autoUpdater.quitAndInstall();
  });

  ipcMain.handle("app:version", () => app.getVersion());
}
