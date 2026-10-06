import Constants from "expo-constants";
import * as FileSystem from "expo-file-system";
import { abrirInstalador } from "../modules/hangar-usb-printer";
import { elegirReleaseMasNuevo, esVersionMasNueva, versionDeTag } from "./releases";

/** Chequeo de actualizaciones vía GitHub Releases — el Punto de Venta se distribuye como .apk
 *  fuera de Play Store (instalación directa), así que no hay tienda que avise de versiones
 *  nuevas. Compara la versión instalada contra el último release `pos-terminal-vX.Y.Z` publicado
 *  (el que genera `release-pos-terminal.yml`) y, si hay una más nueva, la descarga DENTRO de la
 *  app con barra de progreso y abre el instalador de Android (ver descargarApk / instalarApk).
 *  Si algo de eso no está disponible (APK viejo sin la función nativa), cae al navegador.
 *
 *  Mismo mecanismo que apps/waiter-mobile/src/updates.ts. La lógica de selección y comparación
 *  vive en ./releases.ts, sin imports nativos, para poder probarla. */

const REPO = "xavisystem4-lab/hangar421";

export const APP_VERSION: string = Constants.expoConfig?.version ?? "0.0.0";

export interface InfoActualizacion {
  version: string;
  urlDescarga: string;
  urlRelease: string;
}

export async function buscarActualizacion(): Promise<InfoActualizacion | null> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`);
  if (!res.ok) throw new Error(`GitHub respondió ${res.status}`);
  const releases: Array<{ tag_name: string; draft: boolean; html_url: string; assets: { name: string; browser_download_url: string }[] }> = await res.json();

  const release = elegirReleaseMasNuevo(releases);
  if (!release) return null;

  const version = versionDeTag(release.tag_name);
  if (!esVersionMasNueva(version, APP_VERSION)) return null;

  const apk = release.assets.find((a) => a.name.endsWith(".apk"));
  if (!apk) return null;

  return { version, urlDescarga: apk.browser_download_url, urlRelease: release.html_url };
}

/** Descarga el .apk al caché de la app, informando el avance. Devuelve la ruta local (file://). */
export async function descargarApk(
  info: InfoActualizacion,
  alAvanzar: (escritos: number, total: number) => void,
): Promise<string> {
  const destino = `${FileSystem.cacheDirectory}HANGAR-421-${info.version}.apk`;
  const descarga = FileSystem.createDownloadResumable(info.urlDescarga, destino, {}, (p) =>
    alAvanzar(p.totalBytesWritten, p.totalBytesExpectedToWrite),
  );
  const resultado = await descarga.downloadAsync();
  if (!resultado || resultado.status < 200 || resultado.status >= 300) {
    await FileSystem.deleteAsync(destino, { idempotent: true }).catch(() => undefined);
    throw new Error(`La descarga falló (HTTP ${resultado?.status ?? "?"})`);
  }
  return resultado.uri;
}

/** Abre el instalador de Android con el .apk descargado. "permiso" = Android pidió permitir que
 *  el POS instale apps (se abrió ese ajuste; al volver hay que tocar Instalar otra vez).
 *  "no-disponible" = este APK no trae la función nativa: usar el navegador. */
export async function instalarApk(rutaLocal: string): Promise<"ok" | "permiso" | "no-disponible"> {
  const contentUri = await FileSystem.getContentUriAsync(rutaLocal);
  return abrirInstalador(contentUri) ?? "no-disponible";
}
