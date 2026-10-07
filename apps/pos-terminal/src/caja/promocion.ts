import { minutosDeHora, type Promocion, type TipoPromocion } from "@hangar421/shared";

/** Alta/edición de una promoción desde Admin → Catálogo → Promociones. Lógica pura para probarla
 *  con Jest (promocion.spec.ts): convierte lo que el cajero escribe (fechas DD/MM/AAAA, horas,
 *  precio como texto) en la definición que se guarda y se manda al ERP. La regla de precio en sí
 *  vive en packages/shared (precioConPromocion). */

export interface BorradorPromocion {
  nombre: string;
  tipo: TipoPromocion;
  valor: string;
  productoIds: string[];
  /** 0 = domingo … 6 = sábado. Vacío = todos los días. */
  dias: number[];
  horaInicio: string;
  horaFin: string;
  /** DD/MM/AAAA (vacío = sin límite). */
  fechaInicio: string;
  fechaFin: string;
  soloEstaSucursal: boolean;
}

export type DatosPromocion = Omit<Promocion, "id" | "activo">;
export type ResultadoPromocion = { ok: true; valor: DatosPromocion } | { ok: false; error: string };

const dos = (n: number) => String(n).padStart(2, "0");

/** "7/10/2026" o "07/10/2026" → "2026-10-07"; null si está vacío; undefined si no es una fecha real. */
export function fechaDesdeTexto(texto: string): string | null | undefined {
  const t = texto.trim();
  if (!t) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (!m) return undefined;
  const [dia, mes, anio] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const f = new Date(anio, mes - 1, dia);
  if (f.getFullYear() !== anio || f.getMonth() !== mes - 1 || f.getDate() !== dia) return undefined;
  return `${anio}-${dos(mes)}-${dos(dia)}`;
}

/** "2026-10-07" → "07/10/2026" (para volver a mostrarla al editar). */
export function fechaATexto(iso: string | null | undefined): string {
  return iso ? iso.split("-").reverse().join("/") : "";
}

/** "7:05" → "07:05"; null si está vacía; undefined si no es una hora. */
function horaDesdeTexto(texto: string): string | null | undefined {
  const t = texto.trim();
  if (!t) return null;
  const minutos = minutosDeHora(t);
  if (minutos === null) return undefined;
  return `${dos(Math.floor(minutos / 60))}:${dos(minutos % 60)}`;
}

/** `sucursalId` es la de esta tablet: se guarda solo si la promoción es "solo esta sucursal". */
export function validarPromocion(b: BorradorPromocion, sucursalId: string | null): ResultadoPromocion {
  const nombre = b.nombre.trim().replace(/\s+/g, " ");
  if (!nombre) return { ok: false, error: "Ponle un nombre a la promoción (por ejemplo: Latte a $49)." };

  const valor = Number(b.valor.trim().replace(",", ".").replace(/^\$/, "").replace(/%$/, ""));
  if (!b.valor.trim() || !Number.isFinite(valor)) {
    return { ok: false, error: b.tipo === "PRECIO" ? "Escribe el precio especial." : "Escribe el porcentaje de descuento." };
  }
  if (b.tipo === "PRECIO" && valor <= 0) return { ok: false, error: "El precio especial debe ser mayor que $0." };
  if (b.tipo === "PORCENTAJE" && (valor <= 0 || valor > 100)) return { ok: false, error: "El porcentaje debe ser mayor que 0 y hasta 100." };

  const productoIds = [...new Set(b.productoIds)];
  if (productoIds.length === 0) return { ok: false, error: "Elige al menos un producto." };

  const horaInicio = horaDesdeTexto(b.horaInicio);
  const horaFin = horaDesdeTexto(b.horaFin);
  if (horaInicio === undefined || horaFin === undefined) return { ok: false, error: "Escribe la hora como HH:MM, por ejemplo 14:30." };
  if (horaInicio && horaFin && minutosDeHora(horaInicio)! >= minutosDeHora(horaFin)!) {
    return { ok: false, error: "La hora de fin debe ser posterior a la de inicio." };
  }

  const fechaInicio = fechaDesdeTexto(b.fechaInicio);
  const fechaFin = fechaDesdeTexto(b.fechaFin);
  if (fechaInicio === undefined || fechaFin === undefined) return { ok: false, error: "Escribe la fecha como DD/MM/AAAA, por ejemplo 15/10/2026." };
  if (fechaInicio && fechaFin && fechaInicio > fechaFin) return { ok: false, error: "La fecha de fin debe ser igual o posterior a la de inicio." };

  const dias = [...new Set(b.dias)].filter((d) => d >= 0 && d <= 6).sort((a, c) => a - c);
  return {
    ok: true,
    valor: {
      nombre, tipo: b.tipo, valor, productoIds,
      dias: dias.length === 7 ? [] : dias,
      horaInicio, horaFin, fechaInicio, fechaFin,
      sucursalId: b.soloEstaSucursal ? sucursalId : null,
    },
  };
}
