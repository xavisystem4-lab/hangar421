import Constants from "expo-constants";

/** Chequeo de actualizaciones vía GitHub Releases — la app de meseros se distribuye como .apk
 *  fuera de Play Store (instalación directa, ver docs/installation.md §9), así que no hay una
 *  tienda que avise de versiones nuevas. Compara la versión instalada contra el último release
 *  `waiter-vX.Y.Z` publicado (mismo repo que ya usa `release-waiter-apk.yml`) y, si hay una más
 *  nueva, entrega el link directo al .apk para que el usuario lo descargue e instale (Android
 *  ya sabe manejar esa descarga+instalación una vez dado el permiso de "orígenes desconocidos"). */

const REPO = "xavisystem4-lab/hangar421";

export const APP_VERSION: string = Constants.expoConfig?.version ?? "0.0.0";

export interface InfoActualizacion {
  version: string;
  urlDescarga: string;
  urlRelease: string;
}

/** Compara "X.Y.Z" numéricamente (no alfabéticamente — "0.2.9" debe ser menor que "0.10.0"). */
function esVersionMasNueva(candidata: string, actual: string): boolean {
  const a = candidata.split(".").map((n) => Number(n) || 0);
  const b = actual.split(".").map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

export async function buscarActualizacion(): Promise<InfoActualizacion | null> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=20`);
  if (!res.ok) throw new Error(`GitHub respondió ${res.status}`);
  const releases: Array<{ tag_name: string; draft: boolean; html_url: string; assets: { name: string; browser_download_url: string }[] }> = await res.json();

  const releaseMesero = releases.find((r) => !r.draft && r.tag_name?.startsWith("waiter-v"));
  if (!releaseMesero) return null;

  const version = releaseMesero.tag_name.replace(/^waiter-v/, "");
  if (!esVersionMasNueva(version, APP_VERSION)) return null;

  const apk = releaseMesero.assets.find((a) => a.name.endsWith(".apk"));
  if (!apk) return null;

  return { version, urlDescarga: apk.browser_download_url, urlRelease: releaseMesero.html_url };
}
