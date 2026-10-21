import { motivoSinCredito, type HorarioCredito } from "@hangar421/shared";
import { normalizarTexto } from "../db/busqueda";

/** Una empleada con crédito y su saldo vigente (lo calcula monederoRepo.listarMonederosConSaldo). */
export interface EmpleadaConCredito {
  usuarioId: string;
  nombre: string;
  sucursalId: string | null;
  sucursalNombre: string | null;
  limite: number;
  /** Lo que le queda del monedero en el periodo vigente. */
  saldo: number;
  /** Cuándo vuelve a $limite (próximo reinicio), para mostrarlo al cajero. */
  proximoReinicio: Date;
  /** Sucursales donde puede usar su crédito (la suya). Vacío = el ERP no lo dijo. */
  sucursalesPermitidas: string[];
  /** Horario semanal; fuera de él no hay crédito. Vacío = sin horario capturado. */
  horarios: HorarioCredito[];
}

/** Solo las baristas de ESTA sucursal: Mecánicos con Mecánicos, Benito Juárez con Benito Juárez. */
export function empleadasDeSucursal(empleadas: EmpleadaConCredito[], sucursalActual: string | null): EmpleadaConCredito[] {
  if (!sucursalActual) return empleadas;
  return empleadas.filter((e) =>
    e.sucursalesPermitidas.length > 0 ? e.sucursalesPermitidas.includes(sucursalActual) : !e.sucursalId || e.sucursalId === sucursalActual,
  );
}

/** Por qué no puede usar su crédito ahora (null = sí puede): sin saldo, otra sucursal o fuera de horario. */
export function motivoNoDisponible(e: EmpleadaConCredito, sucursalActual: string | null, ahora: Date = new Date()): string | null {
  return motivoSinCredito({ saldo: e.saldo, sucursalesPermitidas: e.sucursalesPermitidas, sucursalActual, horarios: e.horarios, ahora });
}

export interface SucursalDeEmpleadas {
  id: string;
  nombre: string;
}

/** Sucursales que tienen empleadas, sin repetir y por nombre: son los botones del filtro. */
export function sucursalesDeEmpleadas(empleadas: EmpleadaConCredito[]): SucursalDeEmpleadas[] {
  const porId = new Map<string, string>();
  for (const e of empleadas) if (e.sucursalId && e.sucursalNombre) porId.set(e.sucursalId, e.sucursalNombre);
  return [...porId].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

/** Búsqueda por nombre (sin importar mayúsculas ni acentos) y, opcionalmente, por sucursal. */
export function filtrarEmpleadas(empleadas: EmpleadaConCredito[], texto: string, sucursalId: string | null): EmpleadaConCredito[] {
  const buscado = normalizarTexto(texto.trim());
  return empleadas.filter((e) => (!sucursalId || e.sucursalId === sucursalId) && (!buscado || normalizarTexto(e.nombre).includes(buscado)));
}

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** "viernes 9:00 PM" — cuándo vuelve a llenarse el monedero. */
export function textoReinicio(fecha: Date): string {
  const hora12 = fecha.getHours() % 12 === 0 ? 12 : fecha.getHours() % 12;
  return `${DIAS[fecha.getDay()]} ${hora12}:${String(fecha.getMinutes()).padStart(2, "0")} ${fecha.getHours() < 12 ? "AM" : "PM"}`;
}
