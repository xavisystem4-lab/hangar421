import { round2 } from "./calculos";

/**
 * Crédito de empleado: un monedero electrónico por empleada, con un tope (por defecto $500) que
 * se va gastando con sus consumos y se REINICIA a un día y hora fijos de la semana — el saldo no
 * se acumula: lo que sobró se pierde en el reinicio. Es el mismo monedero en cualquier sucursal.
 *
 * Todo son funciones puras; las fechas se interpretan en la hora LOCAL del equipo (la de la
 * sucursal), que es la que usa el negocio para decir "viernes 9 PM".
 */

export const MONEDERO_LIMITE_DEFAULT = 500;

/** Cuándo se reinicia el monedero de una empleada: día de la semana (0 = domingo … 6 = sábado) y hora. */
export interface ReglaReinicioMonedero {
  diaSemana: number;
  hora: number;
  minuto?: number;
}

/** Inicio del periodo vigente: la última vez que, a esa hora y día, el monedero se reinició. */
export function inicioPeriodoMonedero(ahora: Date, regla: ReglaReinicioMonedero): Date {
  const inicio = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), regla.hora, regla.minuto ?? 0, 0, 0);
  const diasAtras = (ahora.getDay() - regla.diaSemana + 7) % 7;
  inicio.setDate(inicio.getDate() - diasAtras);
  if (inicio.getTime() > ahora.getTime()) inicio.setDate(inicio.getDate() - 7);
  return inicio;
}

export interface ConsumoMonedero {
  monto: number;
  /** Cuándo se consumió (ISO o Date). */
  fecha: string | Date;
}

/** Saldo disponible: el tope menos lo consumido desde el último reinicio. Nunca negativo. */
export function saldoMonedero(limite: number, consumos: ConsumoMonedero[], inicioPeriodo: Date): number {
  const gastado = consumos.reduce((acc, c) => (new Date(c.fecha).getTime() >= inicioPeriodo.getTime() ? acc + c.monto : acc), 0);
  return round2(Math.max(limite - gastado, 0));
}

/** Cuánto de la cuenta cubre el monedero y cuánto queda por cobrar con otro método. */
export function calcularUsoMonedero(total: number, saldo: number): { montoMonedero: number; restante: number } {
  const montoMonedero = round2(Math.min(Math.max(saldo, 0), Math.max(total, 0)));
  return { montoMonedero, restante: round2(Math.max(total, 0) - montoMonedero) };
}

// ── Reporte de consumo de crédito de empleados ───────────────────────────────────────────────

export interface ProductoConsumido {
  nombre: string;
  cantidad: number;
  /** Precio unitario cobrado (con promoción si la hubo), sin modificadores. */
  precioUnitario: number;
  /** "Avena (+$25)", "Shot extra (+$15)"… */
  modificadores: { nombre: string; precioExtra: number }[];
}

/** Una venta pagada (total o parcialmente) con el crédito de una empleada. */
export interface ConsumoCredito {
  empleadoId: string;
  empleado: string;
  ventaId: string;
  folio: string | null;
  /** Fecha y hora del cobro (ISO). */
  fecha: string;
  sucursal: string | null;
  /** Lo que se cargó al crédito (puede ser menos que el total si el resto se pagó con otro método). */
  montoCredito: number;
  totalVenta: number;
  productos: ProductoConsumido[];
}

export interface ConsumoPorEmpleada {
  empleadoId: string;
  empleado: string;
  totalCredito: number;
  numConsumos: number;
  numProductos: number;
  /** Del más reciente al más antiguo. */
  consumos: ConsumoCredito[];
}

/** Agrupa los consumos por empleada (la que más consumió primero) — misma regla en ERP y tablet. */
export function agruparConsumosPorEmpleada(consumos: ConsumoCredito[]): ConsumoPorEmpleada[] {
  const porEmpleada = new Map<string, ConsumoPorEmpleada>();
  for (const c of consumos) {
    const g = porEmpleada.get(c.empleadoId) ?? { empleadoId: c.empleadoId, empleado: c.empleado, totalCredito: 0, numConsumos: 0, numProductos: 0, consumos: [] };
    g.totalCredito = round2(g.totalCredito + c.montoCredito);
    g.numConsumos += 1;
    g.numProductos += c.productos.reduce((s, p) => s + p.cantidad, 0);
    g.consumos.push(c);
    porEmpleada.set(c.empleadoId, g);
  }
  const lista = [...porEmpleada.values()];
  for (const g of lista) g.consumos.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
  return lista.sort((a, b) => b.totalCredito - a.totalCredito || a.empleado.localeCompare(b.empleado, "es"));
}

/** "Latte · Avena (+$25)" */
export function describirProductoConsumido(p: ProductoConsumido): string {
  const mods = p.modificadores.map((m) => (m.precioExtra > 0 ? `${m.nombre} (+$${m.precioExtra.toFixed(2)})` : m.nombre));
  return [p.nombre, ...mods].join(" · ");
}

/** CSV (separado por comas, con BOM para Excel) de todos los consumos: una fila por producto. */
export function csvConsumosCredito(grupos: ConsumoPorEmpleada[], formatearFecha: (iso: string) => string): string {
  const esc = (v: string | number) => {
    const t = String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const filas = [["Empleada", "Fecha y hora", "Folio", "Sucursal", "Producto", "Cantidad", "Importe", "Cargado al crédito (venta)"]];
  for (const g of grupos) {
    for (const c of g.consumos) {
      for (const p of c.productos) {
        const importe = round2((p.precioUnitario + p.modificadores.reduce((s, m) => s + m.precioExtra, 0)) * p.cantidad);
        filas.push([g.empleado, formatearFecha(c.fecha), c.folio ?? "", c.sucursal ?? "", describirProductoConsumido(p), String(p.cantidad), importe.toFixed(2), c.montoCredito.toFixed(2)]);
      }
    }
  }
  return "﻿" + filas.map((f) => f.map(esc).join(",")).join("\n");
}
