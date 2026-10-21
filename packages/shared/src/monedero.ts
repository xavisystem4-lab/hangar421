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

// ── Quién puede usar su crédito, dónde y cuándo ──────────────────────────────────────────────

/** Horario semanal de la empleada (ERP → Usuarios → Horarios): "lunes 06:00 a 15:36". */
export interface HorarioCredito {
  /** 0 = domingo … 6 = sábado. */
  diaSemana: number;
  /** "06:00" */
  horaInicio: string;
  /** "15:36" */
  horaFin: string;
  sucursalId?: string | null;
}

function minutosDe(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec((hhmm ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h >= 0 && h <= 24 && min >= 0 && min < 60 ? h * 60 + min : null;
}

/**
 * ¿`ahora` cae dentro de su horario? Sin horario capturado no hay con qué comparar y se permite.
 * Con `sucursalId` solo cuentan los horarios de esa sucursal (o los que no dicen sucursal). Un
 * horario que cruza la medianoche (22:00 a 06:00) cuenta también la madrugada del día siguiente.
 */
export function dentroDeHorario(horarios: HorarioCredito[], ahora: Date, sucursalId?: string | null): boolean {
  if (horarios.length === 0) return true;
  const aplican = horarios.filter((h) => !sucursalId || !h.sucursalId || h.sucursalId === sucursalId);
  const minuto = ahora.getHours() * 60 + ahora.getMinutes();
  const hoy = ahora.getDay();
  const ayer = (hoy + 6) % 7;
  return aplican.some((h) => {
    const ini = minutosDe(h.horaInicio);
    const fin = minutosDe(h.horaFin);
    if (ini === null || fin === null) return false;
    if (fin > ini) return h.diaSemana === hoy && minuto >= ini && minuto <= fin;
    // Cruza la medianoche.
    return (h.diaSemana === hoy && minuto >= ini) || (h.diaSemana === ayer && minuto <= fin);
  });
}

const DIAS_CORTOS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

/** "lun–vie 06:00–15:36" (agrupa los días con el mismo horario). */
export function textoHorario(horarios: HorarioCredito[]): string {
  const porRango = new Map<string, number[]>();
  for (const h of horarios) {
    const clave = `${h.horaInicio}–${h.horaFin}`;
    porRango.set(clave, [...(porRango.get(clave) ?? []), h.diaSemana]);
  }
  return [...porRango]
    .map(([rango, dias]) => {
      const orden = [...new Set(dias)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
      const consecutivos = orden.every((d, i) => i === 0 || (orden[i - 1] + 1) % 7 === d);
      const txt = orden.length > 2 && consecutivos ? `${DIAS_CORTOS[orden[0]]}–${DIAS_CORTOS[orden[orden.length - 1]]}` : orden.map((d) => DIAS_CORTOS[d]).join(", ");
      return `${txt} ${rango}`;
    })
    .join(" · ");
}

/**
 * Por qué una empleada NO puede usar su crédito ahora (null = sí puede). Reglas:
 * sin saldo no hay crédito; solo en su sucursal; solo dentro de su horario.
 */
export function motivoSinCredito(datos: {
  saldo: number;
  sucursalesPermitidas: string[];
  sucursalActual: string | null;
  horarios: HorarioCredito[];
  ahora: Date;
}): string | null {
  if (!(datos.saldo > 0)) return "Ya usó todo su crédito";
  if (datos.sucursalActual && datos.sucursalesPermitidas.length > 0 && !datos.sucursalesPermitidas.includes(datos.sucursalActual)) {
    return "Su crédito es solo en su sucursal";
  }
  if (!dentroDeHorario(datos.horarios, datos.ahora, datos.sucursalActual)) {
    return `Fuera de su horario (${textoHorario(datos.horarios.filter((h) => !datos.sucursalActual || !h.sucursalId || h.sucursalId === datos.sucursalActual)) || "sin horario en esta sucursal"})`;
  }
  return null;
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

/** Hoja "Resumen": una fila por empleada y el total. */
export function filasResumenCredito(grupos: ConsumoPorEmpleada[]): (string | number)[][] {
  const filas: (string | number)[][] = [["Empleada", "Consumos", "Productos", "Total a crédito"]];
  for (const g of grupos) filas.push([g.empleado, g.numConsumos, g.numProductos, g.totalCredito]);
  filas.push(["TOTAL", grupos.reduce((s, g) => s + g.numConsumos, 0), grupos.reduce((s, g) => s + g.numProductos, 0), round2(grupos.reduce((s, g) => s + g.totalCredito, 0))]);
  return filas;
}

/** Hoja "Detalle": una fila por producto consumido, con día, hora y folio. */
export function filasDetalleCredito(grupos: ConsumoPorEmpleada[], formatearFecha: (iso: string) => string): (string | number)[][] {
  const filas: (string | number)[][] = [["Empleada", "Fecha y hora", "Folio", "Sucursal", "Producto", "Cantidad", "Importe", "Cargado al crédito (venta)"]];
  for (const g of grupos) {
    for (const c of g.consumos) {
      for (const p of c.productos) {
        const importe = round2((p.precioUnitario + p.modificadores.reduce((s, m) => s + m.precioExtra, 0)) * p.cantidad);
        filas.push([g.empleado, formatearFecha(c.fecha), c.folio ?? "", c.sucursal ?? "", describirProductoConsumido(p), p.cantidad, importe, c.montoCredito]);
      }
    }
  }
  return filas;
}

/** CSV (separado por comas, con BOM para Excel) de todos los consumos: una fila por producto. */
export function csvConsumosCredito(grupos: ConsumoPorEmpleada[], formatearFecha: (iso: string) => string): string {
  const esc = (v: string | number) => {
    const t = typeof v === "number" ? v.toFixed(2).replace(/\.00$/, "") : String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const filas = filasDetalleCredito(grupos, formatearFecha).map((f, i) =>
    i === 0 ? f : f.map((v, col) => (col === 6 || col === 7 ? Number(v).toFixed(2) : v)),
  );
  return "\uFEFF" + filas.map((f) => f.map(esc).join(",")).join("\n");
}

/**
 * HTML del reporte (hoja carta): encabezado, total, una tabla por empleada con día, hora, folio,
 * productos e importe. Lo usan la tablet (PDF con el motor del sistema) y el correo del ERP.
 */
export function htmlReporteCredito(
  grupos: ConsumoPorEmpleada[],
  opciones: { sucursal: string; periodo: string; fecha: (iso: string) => string; hora: (iso: string) => string; mensaje?: string },
): string {
  const esc = (t: unknown) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
  const total = round2(grupos.reduce((s, g) => s + g.totalCredito, 0));
  const secciones = grupos.map((g) => `
    <h3 style="margin:18px 0 6px;font-size:15px;color:#0b1e33">${esc(g.empleado)} · $${g.totalCredito.toFixed(2)} <span style="font-weight:400;color:#6b7280;font-size:12px">(${g.numConsumos} consumo(s), ${g.numProductos} producto(s))</span></h3>
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="background:#f3f4f6;text-align:left"><th style="padding:5px 6px">Día y fecha</th><th style="padding:5px 6px">Hora</th><th style="padding:5px 6px">Folio</th><th style="padding:5px 6px">Productos</th><th style="padding:5px 6px;text-align:right">A crédito</th></tr></thead>
      <tbody>${g.consumos.map((c) => `<tr>
        <td style="padding:5px 6px;border-bottom:1px solid #e5e7eb;white-space:nowrap">${esc(opciones.fecha(c.fecha))}</td>
        <td style="padding:5px 6px;border-bottom:1px solid #e5e7eb">${esc(opciones.hora(c.fecha))}</td>
        <td style="padding:5px 6px;border-bottom:1px solid #e5e7eb">${c.folio ? "#" + esc(c.folio) : "—"}</td>
        <td style="padding:5px 6px;border-bottom:1px solid #e5e7eb">${c.productos.map((p) => `${p.cantidad} × ${esc(describirProductoConsumido(p))}`).join("<br>") || "(sin detalle)"}</td>
        <td style="padding:5px 6px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700">$${c.montoCredito.toFixed(2)}</td>
      </tr>`).join("")}</tbody>
    </table>`).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"></head><body style="font-family:Arial,Helvetica,sans-serif;color:#111318;margin:24px">
    <div style="border-bottom:2px solid #0b1e33;padding-bottom:10px">
      <div style="font-size:20px;font-weight:800;color:#0b1e33">HANGAR 421 · Crédito de empleados</div>
      <div style="font-size:13px;color:#6b7280">${esc(opciones.sucursal)} · ${esc(opciones.periodo)}</div>
    </div>
    ${opciones.mensaje ? `<p style="white-space:pre-wrap;background:#f9fafb;border-left:3px solid #0b1e33;padding:8px 10px">${esc(opciones.mensaje)}</p>` : ""}
    <p style="font-size:15px;margin:14px 0 4px">Total consumido a crédito: <b>$${total.toFixed(2)}</b> · ${grupos.length} empleada(s)</p>
    ${grupos.length === 0 ? `<p style="color:#6b7280">Nadie usó crédito de empleado en este periodo.</p>` : secciones}
  </body></html>`;
}
