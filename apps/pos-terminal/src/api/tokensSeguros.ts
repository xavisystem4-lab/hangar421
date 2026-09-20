import * as SecureStore from "expo-secure-store";
import { abrirBaseDeDatos } from "../db/database";
import { obtenerConfig, guardarConfig } from "../db/configLocalRepo";

/**
 * Tokens del ERP en el almacenamiento cifrado de Android (Keystore, vía expo-secure-store).
 *
 * Antes vivían en `config_local`, es decir en el archivo SQLite de la app, en texto plano. En un
 * dispositivo con root o con una copia del almacenamiento de la app, cualquiera podía leer el
 * refresh token —que dura 30 días— y hablar con el ERP como si fuera esa terminal. El Keystore
 * los cifra con una clave respaldada por hardware que no sale del dispositivo.
 *
 * Las claves antiguas se migran y se borran la primera vez que se leen (ver migrarSiHaceFalta):
 * una terminal ya enlazada no tiene que volver a vincularse, pero tampoco se queda con el token
 * en claro para siempre.
 */
const CLAVE_ACCESS = "hangar421_erp_access_token";
const CLAVE_REFRESH = "hangar421_erp_refresh_token";

/** Nombres que se usaban cuando los tokens vivían en SQLite. Solo se leen para migrar. */
const CLAVE_LEGADA_ACCESS = "erp_access_token";
const CLAVE_LEGADA_REFRESH = "erp_refresh_token";

export interface TokensErp {
  accessToken: string;
  refreshToken: string;
}

/** SecureStore no está disponible en todos los entornos (por ejemplo bajo Jest o en web). Se
 *  comprueba una vez para poder degradar a SQLite sin que la app deje de funcionar: un POS que
 *  no arranca es peor que uno con el token menos protegido, y el fallo se registra. */
let disponible: boolean | null = null;
async function secureStoreDisponible(): Promise<boolean> {
  if (disponible !== null) return disponible;
  try {
    disponible = await SecureStore.isAvailableAsync();
  } catch {
    disponible = false;
  }
  return disponible;
}

export async function guardarTokens(tokens: TokensErp): Promise<void> {
  if (await secureStoreDisponible()) {
    await SecureStore.setItemAsync(CLAVE_ACCESS, tokens.accessToken);
    await SecureStore.setItemAsync(CLAVE_REFRESH, tokens.refreshToken);
    return;
  }
  const db = await abrirBaseDeDatos();
  await guardarConfig(db, CLAVE_LEGADA_ACCESS, tokens.accessToken);
  await guardarConfig(db, CLAVE_LEGADA_REFRESH, tokens.refreshToken);
}

export async function obtenerTokens(): Promise<TokensErp | null> {
  if (await secureStoreDisponible()) {
    const [accessToken, refreshToken] = await Promise.all([
      SecureStore.getItemAsync(CLAVE_ACCESS),
      SecureStore.getItemAsync(CLAVE_REFRESH),
    ]);
    if (accessToken && refreshToken) return { accessToken, refreshToken };
    // Nada en el almacén seguro: puede ser una terminal que ya estaba enlazada antes de este
    // cambio, así que se intenta migrar lo que hubiera en SQLite.
    return migrarSiHaceFalta();
  }

  const db = await abrirBaseDeDatos();
  const [accessToken, refreshToken] = await Promise.all([
    obtenerConfig(db, CLAVE_LEGADA_ACCESS),
    obtenerConfig(db, CLAVE_LEGADA_REFRESH),
  ]);
  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken };
}

/** Mueve los tokens de SQLite al almacén cifrado y borra los originales. Una terminal ya
 *  enlazada no debe tener que volver a vincularse por este cambio. */
async function migrarSiHaceFalta(): Promise<TokensErp | null> {
  const db = await abrirBaseDeDatos();
  const [accessToken, refreshToken] = await Promise.all([
    obtenerConfig(db, CLAVE_LEGADA_ACCESS),
    obtenerConfig(db, CLAVE_LEGADA_REFRESH),
  ]);
  if (!accessToken || !refreshToken) return null;

  await SecureStore.setItemAsync(CLAVE_ACCESS, accessToken);
  await SecureStore.setItemAsync(CLAVE_REFRESH, refreshToken);
  // Se vacían en vez de borrar la fila: `guardarConfig` hace upsert y dejar la clave con cadena
  // vacía es suficiente para que `obtenerConfig` la trate como ausente.
  await guardarConfig(db, CLAVE_LEGADA_ACCESS, "");
  await guardarConfig(db, CLAVE_LEGADA_REFRESH, "");

  return { accessToken, refreshToken };
}

/** Borra la sesión de la terminal — se usa al desenlazar. */
export async function borrarTokens(): Promise<void> {
  if (await secureStoreDisponible()) {
    await SecureStore.deleteItemAsync(CLAVE_ACCESS).catch(() => undefined);
    await SecureStore.deleteItemAsync(CLAVE_REFRESH).catch(() => undefined);
  }
  const db = await abrirBaseDeDatos();
  await guardarConfig(db, CLAVE_LEGADA_ACCESS, "");
  await guardarConfig(db, CLAVE_LEGADA_REFRESH, "");
}
