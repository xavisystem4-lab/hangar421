import Constants from "expo-constants";
import { elegirReleaseMasNuevo, esVersionMasNueva, versionDeTag } from "./releases";

/** Chequeo de actualizaciones vía GitHub Releases — el Punto de Venta se distribuye como .apk
 *  fuera de Play Store (instalación directa), así que no hay tienda que avise de versiones
 *  nuevas. Compara la versión instalada contra el último release `pos-terminal-vX.Y.Z` publicado
 *  (el que genera `release-pos-terminal.yml`) y, si hay una más nueva, entrega el link directo al
 *  .apk (Android ya sabe descargarlo e instalarlo con el permiso de "orígenes desconocidos").
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
