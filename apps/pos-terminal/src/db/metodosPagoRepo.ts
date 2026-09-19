import type { SQLiteDatabase } from "expo-sqlite";
import { uuid7, MetodoPago } from "@hangar421/shared";

export interface MetodoPagoConfig {
  id: string;
  tipo: MetodoPago;
  habilitado: boolean;
  orden: number;
}

const ETIQUETA: Record<MetodoPago, string> = {
  [MetodoPago.EFECTIVO]: "Efectivo",
  [MetodoPago.TARJETA]: "Tarjeta",
  [MetodoPago.TRANSFERENCIA]: "Transferencia",
  [MetodoPago.QR]: "QR",
  [MetodoPago.OTRO]: "Otro",
};

export { ETIQUETA as etiquetaMetodoPago };

/** Efectivo, Tarjeta, Transferencia y Otro habilitados por defecto; QR apagado hasta que el
 *  negocio configure un proveedor.
 *
 *  Tarjeta estaba apagada por asumir que necesitaba una terminal integrada. No es así: aquí
 *  significa "el cliente pagó con tarjeta en la terminal del banco y lo registro en la venta",
 *  que es como cobra la mayoría de las cafeterías y no requiere integración ninguna — el importe
 *  entra en el corte de caja y en los reportes por método de pago igual que el efectivo. El
 *  cobro integrado contra una terminal Mercado Pago (el que usa el POS Windows) es otra cosa,
 *  necesita red y queda fuera del flujo offline de esta app. */
export async function sembrarMetodosPagoPorDefecto(db: SQLiteDatabase): Promise<void> {
  const { total } = (await db.getFirstAsync<{ total: number }>("SELECT COUNT(*) as total FROM metodos_pago_config")) ?? { total: 0 };
  if (total > 0) return;

  const defaults: { tipo: MetodoPago; habilitado: boolean; orden: number }[] = [
    { tipo: MetodoPago.EFECTIVO, habilitado: true, orden: 1 },
    { tipo: MetodoPago.TARJETA, habilitado: true, orden: 2 },
    { tipo: MetodoPago.TRANSFERENCIA, habilitado: true, orden: 3 },
    { tipo: MetodoPago.QR, habilitado: false, orden: 4 },
    { tipo: MetodoPago.OTRO, habilitado: true, orden: 5 },
  ];

  await db.withTransactionAsync(async () => {
    for (const m of defaults) {
      await db.runAsync("INSERT INTO metodos_pago_config (id, tipo, habilitado, orden) VALUES (?, ?, ?, ?)", uuid7(), m.tipo, m.habilitado ? 1 : 0, m.orden);
    }
  });
}

export async function listarMetodosPago(db: SQLiteDatabase, soloHabilitados = false): Promise<MetodoPagoConfig[]> {
  const filas = await db.getAllAsync<any>(`SELECT * FROM metodos_pago_config ${soloHabilitados ? "WHERE habilitado = 1 " : ""}ORDER BY orden`);
  return filas.map((f) => ({ id: f.id, tipo: f.tipo, habilitado: !!f.habilitado, orden: f.orden }));
}

export async function alternarMetodoPago(db: SQLiteDatabase, id: string, habilitado: boolean): Promise<void> {
  await db.runAsync("UPDATE metodos_pago_config SET habilitado = ? WHERE id = ?", habilitado ? 1 : 0, id);
}
