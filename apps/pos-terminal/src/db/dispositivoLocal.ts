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
/** Solo para mostrar: el indicador de sucursal activa en la cabecera. Se guarda porque la
 *  cabecera se pinta sin conexión y el nombre solo llega en el login/switch. */
const CLAVE_SUCURSAL_NOMBRE = "sucursal_nombre";

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

/** Tablas locales cuyas filas pertenecen a UNA sucursal. El orden no importa; se recorren juntas
 *  al repuntar el placeholder.
 *
 *  `sync_outbox` ya tenía `sucursal_id` desde la migración 1 (las otras cuatro lo ganaron en la
 *  3), pero necesita el repunte igual o más: sus eventos pendientes viajan a `POST /sync/push`
 *  con ese id, y SucursalAccessGuard rechaza con 403 cualquiera que no sea la sucursal activa
 *  del token. Sin esto, TODA venta registrada antes de enlazar quedaría atascada para siempre
 *  — que es justo lo contrario de lo que promete el modo offline. */
const TABLAS_POR_SUCURSAL = ["ventas", "turnos", "movimientos_caja", "usuarios_locales", "sync_outbox"] as const;

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
export async function guardarSucursalErp(db: SQLiteDatabase, sucursalId: string, nombre?: string): Promise<void> {
  const placeholder = await obtenerConfig(db, CLAVE_SUCURSAL_PLACEHOLDER);

  await db.withTransactionAsync(async () => {
    await guardarConfig(db, CLAVE_SUCURSAL_ERP, sucursalId);
    if (nombre) await guardarConfig(db, CLAVE_SUCURSAL_NOMBRE, nombre);
    if (placeholder && placeholder !== sucursalId) {
      for (const tabla of TABLAS_POR_SUCURSAL) {
        await db.runAsync(`UPDATE ${tabla} SET sucursal_id = ? WHERE sucursal_id = ?`, sucursalId, placeholder);
      }
    }
  });
}

/** Cambio de sucursal en una terminal multisucursal: solo mueve el marcador (y el nombre de la
 *  cabecera). A diferencia de guardarSucursalErp NO repunta ninguna fila: lo registrado en la
 *  sucursal anterior es de esa sucursal y así debe quedar en el historial. */
export async function cambiarSucursalActiva(db: SQLiteDatabase, sucursalId: string, nombre: string): Promise<void> {
  await db.withTransactionAsync(async () => {
    await guardarConfig(db, CLAVE_SUCURSAL_ERP, sucursalId);
    await guardarConfig(db, CLAVE_SUCURSAL_NOMBRE, nombre);
  });
}

export async function obtenerSucursalErp(db: SQLiteDatabase): Promise<string | null> {
  return obtenerConfig(db, CLAVE_SUCURSAL_ERP);
}

const CLAVE_EMPRESA_PLACEHOLDER = "empresa_id_local";
const CLAVE_EMPRESA_ERP = "empresa_id_erp";

/**
 * Empresa que viaja en el payload de cada venta. Prefiere el id REAL del ERP igual que
 * `obtenerOCrearSucursalIdLocal` hace con la sucursal.
 *
 * Antes solo devolvía un placeholder generado en el dispositivo, y nadie lo sustituía nunca por
 * el real. Resultado: toda venta empujada a `/sync/push` llevaba un `empresaId` que no existe
 * server-side, `PedidosService.crear` fallaba por clave foránea y la venta quedaba en ERROR —
 * la app decía "sincronizado" pero en el ERP no aparecía ninguna venta.
 */
export async function obtenerOCrearEmpresaIdLocal(db: SQLiteDatabase): Promise<string> {
  const real = await obtenerConfig(db, CLAVE_EMPRESA_ERP);
  if (real) return real;
  const existente = await obtenerConfig(db, CLAVE_EMPRESA_PLACEHOLDER);
  if (existente) return existente;
  const id = uuid7();
  await guardarConfig(db, CLAVE_EMPRESA_PLACEHOLDER, id);
  return id;
}

/**
 * Guarda la empresa real del ERP y **repunta las ventas ya encoladas** que llevaban el
 * placeholder en su payload.
 *
 * Sin esto, todo lo vendido antes de enlazar quedaría rechazado para siempre: el payload es un
 * JSON congelado en el momento de la venta, así que cambiar la preferencia solo arregla las
 * ventas futuras. Se parchea en JS y no con json_set de SQLite para no depender de que la
 * compilación de expo-sqlite traiga la extensión JSON1.
 */
export async function guardarEmpresaErp(db: SQLiteDatabase, empresaId: string): Promise<void> {
  const placeholder = await obtenerConfig(db, CLAVE_EMPRESA_PLACEHOLDER);
  await guardarConfig(db, CLAVE_EMPRESA_ERP, empresaId);
  if (!placeholder || placeholder === empresaId) return;

  const pendientes = await db.getAllAsync<{ local_id: string; payload: string }>(
    "SELECT local_id, payload FROM sync_outbox WHERE estado IN ('PENDING','ERROR')",
  );
  for (const fila of pendientes) {
    try {
      const payload = JSON.parse(fila.payload);
      if (payload?.empresaId !== placeholder) continue;
      payload.empresaId = empresaId;
      // Se devuelve a PENDING y se limpia el backoff: la que ya había fallado por este motivo
      // debe reintentarse de inmediato, no esperar su siguiente ventana.
      await db.runAsync(
        "UPDATE sync_outbox SET payload = ?, estado = 'PENDING', ultimo_error = NULL, next_retry_at = NULL WHERE local_id = ?",
        JSON.stringify(payload), fila.local_id,
      );
    } catch {
      // Un payload ilegible no debe impedir reparar los demás.
    }
  }
}

/** Nombre de la sucursal activa, o null si la terminal todavía no se ha enlazado al ERP. */
export async function obtenerNombreSucursal(db: SQLiteDatabase): Promise<string | null> {
  return obtenerConfig(db, CLAVE_SUCURSAL_NOMBRE);
}
