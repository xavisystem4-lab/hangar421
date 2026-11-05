/**
 * Reporte de ventas de un periodo (p. ej. un mes) — lógica PURA, compartida por el ERP y la
 * tablet: quién vende más y cuándo. Agrupa las ventas cobradas por cafetería, por empleado, por
 * día de la semana, por hora, por turno (mañana / tarde) y por fecha, y dice cuál es el mejor de
 * cada grupo.
 *
 * Las horas y los días se cuentan en la zona horaria de la sucursal (`zona`), no en la del
 * navegador ni en UTC: una venta de las 11 p. m. en Mexicali es otro día en UTC.
 */

export interface VentaParaReporte {
  fecha: string | Date;
  total: number;
  /** Nombre de la cafetería (sucursal). */
  sucursal: string;
  /** Quién cobró la venta. */
  empleado: string;
  /** Apertura del turno de caja en el que se cobró; null = venta sin turno. */
  turnoApertura?: string | Date | null;
}

export interface GrupoReporte {
  clave: string;
  tickets: number;
  total: number;
  ticketPromedio: number;
  /** Porcentaje del total vendido en el periodo (0–100). */
  porcentaje: number;
}

export interface ReportePeriodo {
  tickets: number;
  total: number;
  ticketPromedio: number;
  porSucursal: GrupoReporte[];
  /** Clave "Empleado · Sucursal": una empleada que cubrió en otra cafetería sale por separado. */
  porEmpleado: (GrupoReporte & { empleado: string; sucursal: string })[];
  /** Lunes a domingo, en ese orden (los días sin ventas salen en cero). */
  porDiaSemana: GrupoReporte[];
  /** Solo las horas con ventas, de la más temprana a la más tarde ("07:00"). */
  porHora: (GrupoReporte & { hora: number })[];
  /** "Mañana" / "Tarde" / "Sin turno", por cafetería. */
  porTurno: (GrupoReporte & { sucursal: string; turno: string })[];
  /** Cada fecha del periodo con ventas ("2026-10-23"), en orden. */
  porFecha: (GrupoReporte & { fecha: string })[];
  /** Lo que más vendió de cada grupo (por importe). null si no hubo ventas. */
  mejor: {
    sucursal: GrupoReporte | null;
    empleado: (GrupoReporte & { empleado: string; sucursal: string }) | null;
    diaSemana: GrupoReporte | null;
    hora: (GrupoReporte & { hora: number }) | null;
    turno: (GrupoReporte & { sucursal: string; turno: string }) | null;
    fecha: (GrupoReporte & { fecha: string }) | null;
  };
}

export const DIAS_SEMANA = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"] as const;

/** Los turnos que abren antes de esta hora son "de la mañana"; los demás, "de la tarde". */
export const HORA_CORTE_TURNO = 12;

const r2 = (n: number) => Math.round(n * 100) / 100;

/** `zona = "local"`: la del dispositivo, con los getters de Date (la tablet no depende de Intl). */
function partesEnZona(fecha: string | Date, zona: string): { fecha: string; hora: number; diaSemana: number } {
  const d = typeof fecha === "string" ? new Date(fecha) : fecha;
  if (zona === "local") {
    const p2 = (n: number) => String(n).padStart(2, "0");
    return { fecha: `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`, hora: d.getHours(), diaSemana: (d.getDay() + 6) % 7 };
  }
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", hourCycle: "h23", weekday: "short",
  }).formatToParts(d);
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  const dias: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return { fecha: `${v("year")}-${v("month")}-${v("day")}`, hora: Number(v("hour")) % 24, diaSemana: dias[v("weekday")] ?? 0 };
}

/** "Mañana", "Tarde" o "Sin turno" según la hora (en la zona) a la que abrió el turno. */
export function turnoDelDia(apertura: string | Date | null | undefined, zona: string): "Mañana" | "Tarde" | "Sin turno" {
  if (!apertura) return "Sin turno";
  return partesEnZona(apertura, zona).hora < HORA_CORTE_TURNO ? "Mañana" : "Tarde";
}

/** "07:00 – 08:00". */
export function etiquetaHora(hora: number): string {
  const f = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;
  return `${f(hora)} – ${f(hora + 1)}`;
}

export function armarReportePeriodo(ventas: VentaParaReporte[], zona: string): ReportePeriodo {
  const acumular = <E extends object>() => new Map<string, { tickets: number; total: number; extra: E }>();
  const sumar = <E extends object>(m: Map<string, { tickets: number; total: number; extra: E }>, clave: string, total: number, extra: E) => {
    const g = m.get(clave) ?? { tickets: 0, total: 0, extra };
    g.tickets += 1;
    g.total += total;
    m.set(clave, g);
  };

  const suc = acumular<object>();
  const emp = acumular<{ empleado: string; sucursal: string }>();
  const dia = acumular<object>();
  const hora = acumular<{ hora: number }>();
  const tur = acumular<{ sucursal: string; turno: string }>();
  const fec = acumular<{ fecha: string }>();
  let tickets = 0;
  let total = 0;

  for (const v of ventas) {
    const monto = Number(v.total) || 0;
    const p = partesEnZona(v.fecha, zona);
    const sucursal = v.sucursal?.trim() || "Sin sucursal";
    const empleado = v.empleado?.trim() || "Sin empleado";
    const turno = turnoDelDia(v.turnoApertura, zona);
    tickets += 1;
    total += monto;
    sumar(suc, sucursal, monto, {});
    sumar(emp, `${empleado} · ${sucursal}`, monto, { empleado, sucursal });
    sumar(dia, DIAS_SEMANA[p.diaSemana], monto, {});
    sumar(hora, String(p.hora), monto, { hora: p.hora });
    sumar(tur, `${sucursal} · ${turno}`, monto, { sucursal, turno });
    sumar(fec, p.fecha, monto, { fecha: p.fecha });
  }

  const grupo = <E extends object>(clave: string, g: { tickets: number; total: number; extra: E }): GrupoReporte & E => ({
    clave,
    tickets: g.tickets,
    total: r2(g.total),
    ticketPromedio: g.tickets > 0 ? r2(g.total / g.tickets) : 0,
    porcentaje: total > 0 ? r2((g.total / total) * 100) : 0,
    ...g.extra,
  });
  const lista = <E extends object>(m: Map<string, { tickets: number; total: number; extra: E }>) => [...m.entries()].map(([k, g]) => grupo(k, g));
  const porImporte = <T extends GrupoReporte>(a: T, b: T) => b.total - a.total || b.tickets - a.tickets || a.clave.localeCompare(b.clave, "es");
  const mejorDe = <T extends GrupoReporte>(xs: T[]): T | null => (xs.length ? [...xs].sort(porImporte)[0] : null);

  const porSucursal = lista(suc).sort(porImporte);
  const porEmpleado = lista(emp).sort(porImporte);
  const porDiaSemana = DIAS_SEMANA.map((d) => grupo(d, dia.get(d) ?? { tickets: 0, total: 0, extra: {} }));
  const porHora = lista(hora).sort((a, b) => a.hora - b.hora);
  const porTurno = lista(tur).sort(porImporte);
  const porFecha = lista(fec).sort((a, b) => a.fecha.localeCompare(b.fecha));

  return {
    tickets,
    total: r2(total),
    ticketPromedio: tickets > 0 ? r2(total / tickets) : 0,
    porSucursal,
    porEmpleado,
    porDiaSemana,
    porHora,
    porTurno,
    porFecha,
    mejor: {
      sucursal: mejorDe(porSucursal),
      empleado: mejorDe(porEmpleado),
      diaSemana: mejorDe(porDiaSemana.filter((d) => d.tickets > 0)),
      hora: mejorDe(porHora),
      turno: mejorDe(porTurno),
      fecha: mejorDe(porFecha),
    },
  };
}
