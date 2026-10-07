import type { SQLiteDatabase } from "expo-sqlite";
import { inicioPeriodoMonedero, saldoMonedero, type ReglaReinicioMonedero } from "@hangar421/shared";
import type { EmpleadaConCredito } from "../caja/creditoEmpleado";

/**
 * Crédito de empleado (monedero electrónico) en la terminal. Todo es local para cobrar sin red; el
 * ERP solo refresca la lista de empleadas y los consumos que se hicieron en OTRAS tablets
 * (sync/terminalErp.ts). El saldo no se guarda: es `límite − consumos desde el último reinicio`.
 */

export interface MonederoErp {
  usuarioId: string;
  nombre: string;
  sucursalId: string | null;
  sucursalNombre: string | null;
  limite: number;
  diaReinicio: number;
  horaReinicio: number;
  minutoReinicio: number;
}

export interface MovimientoMonederoErp {
  id: string;
  usuarioId: string;
  monto: number;
  fecha: string;
}

/** Más viejo que esto no puede afectar un saldo (el reinicio es, como mucho, semanal). */
const DIAS_QUE_SE_CONSERVAN = 9;

/** Reemplaza la lista de empleadas y suma los consumos que trae el ERP.
 *
 *  Los consumos se mezclan por id, NO se reemplazan: una venta hecha aquí y todavía sin subir tiene
 *  su movimiento local, y borrarlo dejaría a la empleada con saldo de más. El mismo id (el de la
 *  venta) en el ERP y aquí es la misma fila, así que tampoco se cuenta doble. */
export async function guardarMonederos(db: SQLiteDatabase, datos: { monederos: MonederoErp[]; movimientos: MovimientoMonederoErp[] }): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync("DELETE FROM monederos_empleado");
    for (const m of datos.monederos) {
      await db.runAsync(
        `INSERT INTO monederos_empleado (usuario_id, nombre, sucursal_id, sucursal_nombre, limite, dia_reinicio, hora_reinicio, minuto_reinicio)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        m.usuarioId, m.nombre, m.sucursalId, m.sucursalNombre, m.limite, m.diaReinicio, m.horaReinicio, m.minutoReinicio,
      );
    }
    for (const mv of datos.movimientos) {
      await db.runAsync("INSERT OR REPLACE INTO monedero_movimientos (id, usuario_id, monto, fecha) VALUES (?, ?, ?, ?)", mv.id, mv.usuarioId, mv.monto, mv.fecha);
    }
    const limite = new Date(Date.now() - DIAS_QUE_SE_CONSERVAN * 24 * 60 * 60 * 1000).toISOString();
    await db.runAsync("DELETE FROM monedero_movimientos WHERE fecha < ?", limite);
  });
}

/** Empleadas con crédito y su saldo al momento `ahora`, por nombre. */
export async function listarMonederosConSaldo(db: SQLiteDatabase, ahora: Date = new Date()): Promise<EmpleadaConCredito[]> {
  const [monederos, movimientos] = await Promise.all([
    db.getAllAsync<any>("SELECT * FROM monederos_empleado ORDER BY nombre COLLATE NOCASE"),
    db.getAllAsync<{ usuario_id: string; monto: number; fecha: string }>("SELECT usuario_id, monto, fecha FROM monedero_movimientos"),
  ]);
  return monederos.map((m) => {
    const regla: ReglaReinicioMonedero = { diaSemana: m.dia_reinicio, hora: m.hora_reinicio, minuto: m.minuto_reinicio };
    const inicio = inicioPeriodoMonedero(ahora, regla);
    const proximoReinicio = new Date(inicio);
    proximoReinicio.setDate(proximoReinicio.getDate() + 7);
    return {
      usuarioId: m.usuario_id,
      nombre: m.nombre,
      sucursalId: m.sucursal_id,
      sucursalNombre: m.sucursal_nombre,
      limite: m.limite,
      saldo: saldoMonedero(m.limite, movimientos.filter((x) => x.usuario_id === m.usuario_id).map((x) => ({ monto: x.monto, fecha: x.fecha })), inicio),
      proximoReinicio,
    };
  });
}

/** Carga un consumo al monedero. Se llama DENTRO de la transacción de la venta (ver
 *  ventasRepo.confirmarVenta) para que venta, pago y consumo sean todo o nada. */
export async function registrarConsumoMonedero(db: SQLiteDatabase, datos: { ventaId: string; usuarioId: string; monto: number; fecha: string }): Promise<void> {
  await db.runAsync("INSERT OR REPLACE INTO monedero_movimientos (id, usuario_id, monto, fecha) VALUES (?, ?, ?, ?)", datos.ventaId, datos.usuarioId, datos.monto, datos.fecha);
}

/** Devuelve el saldo cuando se cancela la venta (el id del movimiento es el de la venta). */
export async function revertirConsumoMonedero(db: SQLiteDatabase, ventaId: string): Promise<void> {
  await db.runAsync("DELETE FROM monedero_movimientos WHERE id = ?", ventaId);
}
