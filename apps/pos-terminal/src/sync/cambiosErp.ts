import type { SQLiteDatabase } from "expo-sqlite";
import { erpFetch } from "../api/erpHttp";
import { guardarConfig, obtenerConfig } from "../db/configLocalRepo";

/**
 * Cambios del ERP al instante. El ERP mueve una marca por empresa cada vez que alguien cambia
 * catálogo, precios, recetas, insumos, crédito o usuarios (MarcaCambioErp). La tablet la consulta
 * cada pocos segundos; si es más nueva que su última descarga completa, suena un pitido y aparece
 * "Descargar modificación de ERP". La lógica pura está en cambiosErpLogica.ts.
 */
export { hayCambioNuevo, type MarcaErp } from "./cambiosErpLogica";
import type { MarcaErp } from "./cambiosErpLogica";

const CLAVE_APLICADA = "cambios_erp_aplicado";

export async function leerMarcaErp(): Promise<MarcaErp> {
  return erpFetch<MarcaErp>("/sync/cambios");
}

export async function versionAplicada(db: SQLiteDatabase): Promise<string | null> {
  return obtenerConfig(db, CLAVE_APLICADA);
}

/** Tras una descarga completa: lo que el ERP tenía al empezar ya está en la tablet. Sin marca en
 *  el ERP (nunca se ha cambiado nada) se guarda la hora de la descarga. */
export async function guardarVersionAplicada(db: SQLiteDatabase, version: string | null): Promise<void> {
  await guardarConfig(db, CLAVE_APLICADA, version ?? new Date().toISOString());
}
