/**
 * Compras de insumos y su historial de costos — lógica PURA, compartida por el backend y el ERP.
 *
 * Cada compra queda como un registro propio con su precio (nunca se sobrescribe el anterior), así
 * se puede responder "¿cuánto costó la leche el mes pasado?" y ver cómo ha cambiado el precio.
 *
 * Unidades: el insumo vive en su unidad base (ml, g, pz…). La compra se captura como se compra
 * (cartones, kilos, cajas…) con un factor "unidades base por unidad capturada"; el costo por
 * unidad base es el que alimenta el costo del insumo y las recetas.
 */

export type EstadoCompra = "VIGENTE" | "ANULADA";

export interface CapturaCompra {
  /** Cantidad como se compró: 20 (litros), 4 (cartones), 2.5 (kg). */
  cantidadCaptura: number;
  /** Unidades base que trae cada unidad capturada: 1000 si se capturan litros de un insumo en ml. */
  factor: number;
  /** Precio pagado por CADA unidad capturada ($20 por litro). Se usa si no viene `total`. */
  precioCaptura?: number | null;
  /** Total pagado. Si viene, manda sobre el precio unitario (el ticket dice el total). */
  total?: number | null;
}

export interface CompraCalculada {
  /** Cantidad que entra al inventario, en la unidad base del insumo. */
  cantidadBase: number;
  /** Precio por unidad capturada ($ por litro, por cartón…). */
  precioCaptura: number;
  /** Costo por unidad base ($ por ml): el que usan recetas y valuación. */
  costoUnitarioBase: number;
  total: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10_000) / 10_000;
const r6 = (n: number) => Math.round(n * 1_000_000) / 1_000_000;

/** Calcula cantidad base, precio unitario y total de una compra; lanza si los datos no sirven. */
export function calcularCompra(c: CapturaCompra): CompraCalculada {
  const cantidad = Number(c.cantidadCaptura);
  const factor = Number(c.factor);
  if (!Number.isFinite(cantidad) || cantidad <= 0) throw new Error("La cantidad comprada debe ser mayor que cero.");
  if (!Number.isFinite(factor) || factor <= 0) throw new Error("La unidad de compra no es válida.");
  const totalDado = c.total != null && String(c.total) !== "" ? Number(c.total) : null;
  const precioDado = c.precioCaptura != null && String(c.precioCaptura) !== "" ? Number(c.precioCaptura) : null;
  let total: number;
  let precio: number;
  if (totalDado != null && Number.isFinite(totalDado)) {
    if (totalDado < 0) throw new Error("El total no puede ser negativo.");
    total = r2(totalDado);
    precio = r4(totalDado / cantidad);
  } else if (precioDado != null && Number.isFinite(precioDado)) {
    if (precioDado < 0) throw new Error("El precio no puede ser negativo.");
    precio = r4(precioDado);
    total = r2(precioDado * cantidad);
  } else {
    throw new Error("Falta el precio o el total de la compra.");
  }
  const cantidadBase = r4(cantidad * factor);
  return { cantidadBase, precioCaptura: precio, costoUnitarioBase: r6(total / cantidadBase), total };
}

/** Una compra como la devuelve el ERP (lo necesario para los reportes). */
export interface CompraRegistro {
  id: string;
  fechaCompra: string;
  insumoId: string;
  insumo: string;
  categoria: string;
  unidadBase: string;
  cantidadBase: number;
  costoUnitarioBase: number;
  unidadCaptura: string;
  cantidadCaptura: number;
  precioCaptura: number;
  factor: number;
  total: number;
  proveedor: string | null;
  usuario: string | null;
  sucursal: string | null;
  estado: EstadoCompra;
}

export interface ResumenInsumoCompras {
  insumoId: string;
  insumo: string;
  categoria: string;
  unidadBase: string;
  compras: number;
  cantidadBase: number;
  total: number;
  /** Promedio ponderado por cantidad: total / cantidad (por unidad base). */
  costoPromedioBase: number;
  /** Primera y última compra del periodo (por fecha). */
  primerCostoBase: number;
  ultimoCostoBase: number;
  ultimaFecha: string;
  minimoBase: number;
  maximoBase: number;
  /** Cambio del primer al último costo del periodo, en % (0 si solo hubo una compra). */
  variacionPct: number;
  /** Para mostrar el precio "como se compra": la unidad de captura más usada y su factor. */
  unidadCaptura: string;
  factorCaptura: number;
}

export interface ResumenCompras {
  compras: number;
  total: number;
  porInsumo: ResumenInsumoCompras[];
  porCategoria: { clave: string; compras: number; total: number; porcentaje: number }[];
  porProveedor: { clave: string; compras: number; total: number; porcentaje: number }[];
  porUsuario: { clave: string; compras: number; total: number; porcentaje: number }[];
  /** "2026-10" → total y compras del mes, en orden. */
  porMes: { mes: string; compras: number; total: number }[];
  /** Insumos cuyo último costo es mayor que el primero del periodo, de mayor a menor alza. */
  subieron: ResumenInsumoCompras[];
}

/** Agrupa las compras VIGENTES (las anuladas no cuentan en ningún total). */
export function resumirCompras(compras: CompraRegistro[]): ResumenCompras {
  const vigentes = compras.filter((c) => c.estado !== "ANULADA").sort((a, b) => a.fechaCompra.localeCompare(b.fechaCompra));
  const total = r2(vigentes.reduce((s, c) => s + c.total, 0));

  const porInsumo = new Map<string, CompraRegistro[]>();
  for (const c of vigentes) porInsumo.set(c.insumoId, [...(porInsumo.get(c.insumoId) ?? []), c]);
  const insumos: ResumenInsumoCompras[] = [...porInsumo.values()].map((cs) => {
    const cantidad = cs.reduce((s, c) => s + c.cantidadBase, 0);
    const tot = cs.reduce((s, c) => s + c.total, 0);
    const costos = cs.map((c) => c.costoUnitarioBase);
    const primero = cs[0];
    const ultimo = cs[cs.length - 1];
    const unidades = new Map<string, { n: number; factor: number }>();
    for (const c of cs) {
      const u = unidades.get(c.unidadCaptura) ?? { n: 0, factor: c.factor };
      u.n += 1;
      unidades.set(c.unidadCaptura, u);
    }
    const [unidadCaptura, { factor }] = [...unidades.entries()].sort((a, b) => b[1].n - a[1].n)[0];
    return {
      insumoId: ultimo.insumoId,
      insumo: ultimo.insumo,
      categoria: ultimo.categoria,
      unidadBase: ultimo.unidadBase,
      compras: cs.length,
      cantidadBase: r4(cantidad),
      total: r2(tot),
      costoPromedioBase: cantidad > 0 ? r6(tot / cantidad) : 0,
      primerCostoBase: primero.costoUnitarioBase,
      ultimoCostoBase: ultimo.costoUnitarioBase,
      ultimaFecha: ultimo.fechaCompra,
      minimoBase: Math.min(...costos),
      maximoBase: Math.max(...costos),
      variacionPct: cs.length > 1 && primero.costoUnitarioBase > 0 ? r2(((ultimo.costoUnitarioBase - primero.costoUnitarioBase) / primero.costoUnitarioBase) * 100) : 0,
      unidadCaptura,
      factorCaptura: factor,
    };
  });

  const agrupar = (clave: (c: CompraRegistro) => string) => {
    const m = new Map<string, { compras: number; total: number }>();
    for (const c of vigentes) {
      const k = clave(c);
      const g = m.get(k) ?? { compras: 0, total: 0 };
      g.compras += 1;
      g.total += c.total;
      m.set(k, g);
    }
    return [...m.entries()]
      .map(([k, g]) => ({ clave: k, compras: g.compras, total: r2(g.total), porcentaje: total > 0 ? r2((g.total / total) * 100) : 0 }))
      .sort((a, b) => b.total - a.total || a.clave.localeCompare(b.clave, "es"));
  };

  const meses = new Map<string, { compras: number; total: number }>();
  for (const c of vigentes) {
    const mes = c.fechaCompra.slice(0, 7);
    const g = meses.get(mes) ?? { compras: 0, total: 0 };
    g.compras += 1;
    g.total += c.total;
    meses.set(mes, g);
  }

  return {
    compras: vigentes.length,
    total,
    porInsumo: insumos.sort((a, b) => b.total - a.total || a.insumo.localeCompare(b.insumo, "es")),
    porCategoria: agrupar((c) => c.categoria || "Otros"),
    porProveedor: agrupar((c) => c.proveedor?.trim() || "Sin proveedor"),
    porUsuario: agrupar((c) => c.usuario?.trim() || "—"),
    porMes: [...meses.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([mes, g]) => ({ mes, compras: g.compras, total: r2(g.total) })),
    subieron: insumos.filter((i) => i.variacionPct > 0).sort((a, b) => b.variacionPct - a.variacionPct),
  };
}

/** Rango [desde, hasta] (AAAA-MM-DD) de los periodos rápidos, relativo a `hoy` (fecha local). */
export type PeriodoCompras = "hoy" | "ayer" | "7dias" | "mes" | "mesAnterior" | "anio";

export function rangoDePeriodo(periodo: PeriodoCompras, hoy: Date): { desde: string; hasta: string } {
  const f = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const y = hoy.getFullYear();
  const m = hoy.getMonth();
  const d = hoy.getDate();
  switch (periodo) {
    case "hoy":
      return { desde: f(hoy), hasta: f(hoy) };
    case "ayer": {
      const a = new Date(y, m, d - 1);
      return { desde: f(a), hasta: f(a) };
    }
    case "7dias":
      return { desde: f(new Date(y, m, d - 6)), hasta: f(hoy) };
    case "mes":
      return { desde: f(new Date(y, m, 1)), hasta: f(new Date(y, m + 1, 0)) };
    case "mesAnterior":
      return { desde: f(new Date(y, m - 1, 1)), hasta: f(new Date(y, m, 0)) };
    case "anio":
      return { desde: f(new Date(y, 0, 1)), hasta: f(new Date(y, 11, 31)) };
  }
}

/** "$0.020/ml" → "$20.00 por litro" cuando conviene mostrarlo en la unidad de compra. */
export function costoEnUnidadCaptura(costoBase: number, factor: number): number {
  return r2(costoBase * factor);
}
