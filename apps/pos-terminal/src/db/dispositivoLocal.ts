import type { SQLiteDatabase } from "expo-sqlite";
import { uuid7 } from "@hangar421/shared";
import { obtenerConfig, guardarConfig } from "./configLocalRepo";

const CLAVE_DISPOSITIVO = "dispositivo_id";
const CLAVE_SUCURSAL_PLACEHOLDER = "sucursal_id_local";
// La poblada por ConexionErpScreen (Fase 2a) al conectar de verdad — un id real de Sucursal que
// SÍ existe server-side. Mientras no exista, se usa el placeholder de abajo (un UUID que no
// corresponde a ninguna fila real): las ventas se guardan igual de completas y atómicas en local,
// pero esas filas de sync_outbox no van a poder sincronizar hasta que el dispositivo se conecte
// — es esperado, no un bug (ver "Sin conexión"/"Pendiente" en el indicador de 4 estados).
const CLAVE_SUCURSAL_ERP = "sucursal_id_erp";

export async function obtenerOCrearDispositivoId(db: SQLiteDatabase): Promise<string> {
  const existente = await obtenerConfig(db, CLAVE_DISPOSITIVO);
  if (existente) return existente;
  const id = uuid7();
  await guardarConfig(db, CLAVE_DISPOSITIVO, id);
  return id;
}

/** Prefiere el id REAL de sucursal (una vez conectado al ERP) sobre el placeholder local — así
 *  toda venta/turno nuevo que se registre después de conectar ya lleva el id correcto en su
 *  fila de sync_outbox, sin tener que tocar ventasRepo/turnosRepo. */
export async function obtenerOCrearSucursalIdLocal(db: SQLiteDatabase): Promise<string> {
  const real = await obtenerConfig(db, CLAVE_SUCURSAL_ERP);
  if (real) return real;
  const existente = await obtenerConfig(db, CLAVE_SUCURSAL_PLACEHOLDER);
  if (existente) return existente;
  const id = uuid7();
  await guardarConfig(db, CLAVE_SUCURSAL_PLACEHOLDER, id);
  return id;
}

/** Tablas locales cuyas filas pertenecen a UNA sucursal (migración 3). El orden no importa; se
 *  recorren juntas al repuntar el placeholder. */
const TABLAS_POR_SUCURSAL = ["ventas", "turnos", "movimientos_caja", "usuarios_locales"] as const;

/** Enlaza el dispositivo a una sucursal real del ERP.
 *
 *  Además de guardar el id, **repunta a la sucursal real todo lo que se registró antes de
 *  enlazar**. Sin esto, un dispositivo que vendió offline y luego se conecta vería su historial,
 *  su turno abierto y sus usuarios locales desaparecer de golpe: esas filas quedaron con el
 *  placeholder, mientras que las consultas pasarían a acotarse por el id del ERP (que es el que
 *  obtenerOCrearSucursalIdLocal() prefiere en cuanto existe).
 *
 *  Todo en una transacción: o se mueve el marcador y los datos juntos, o no se mueve nada. El
 *  índice único (sucursal_id, folio_local) no puede chocar aquí porque el placeholder deja de
 *  existir tras el primer enlace — un segundo enlace ya no encuentra filas que mover. */
export async function guardarSucursalErp(db: SQLiteDatabase, sucursalId: string): Promise<void> {
  const placeholder = await obtenerConfig(db, CLAVE_SUCURSAL_PLACEHOLDER);

  await db.withTransactionAsync(async () => {
    await guardarConfig(db, CLAVE_SUCURSAL_ERP, sucursalId);
    if (placeholder && placeholder !== sucursalId) {
      for (const tabla of TABLAS_POR_SUCURSAL) {
        await db.runAsync(`UPDATE ${tabla} SET sucursal_id = ? WHERE sucursal_id = ?`, sucursalId, placeholder);
      }
    }
  });
}

export async function obtenerSucursalErp(db: SQLiteDatabase): Promise<string | null> {
  return obtenerConfig(db, CLAVE_SUCURSAL_ERP);
}
