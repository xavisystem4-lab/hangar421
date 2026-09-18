import type { SQLiteDatabase } from "expo-sqlite";
import { uuid7 } from "@hangar421/shared";
import { obtenerConfig, guardarConfig } from "./configLocalRepo";

const CLAVE_DISPOSITIVO = "dispositivo_id";
// Placeholder hasta Fase 2b (configuración inicial real): ahí se reemplaza por el id de
// Sucursal que devuelve POST /sucursales al darse de alta en el ERP. Mientras tanto, todo lo
// que se venda queda igual de persistido y atómico localmente — el reemplazo es solo cambiar
// esta cadena en config_local, no toca ninguna fila de ventas/turnos ya guardada.
const CLAVE_SUCURSAL_PLACEHOLDER = "sucursal_id_local";

export async function obtenerOCrearDispositivoId(db: SQLiteDatabase): Promise<string> {
  const existente = await obtenerConfig(db, CLAVE_DISPOSITIVO);
  if (existente) return existente;
  const id = uuid7();
  await guardarConfig(db, CLAVE_DISPOSITIVO, id);
  return id;
}

export async function obtenerOCrearSucursalIdLocal(db: SQLiteDatabase): Promise<string> {
  const existente = await obtenerConfig(db, CLAVE_SUCURSAL_PLACEHOLDER);
  if (existente) return existente;
  const id = uuid7();
  await guardarConfig(db, CLAVE_SUCURSAL_PLACEHOLDER, id);
  return id;
}
