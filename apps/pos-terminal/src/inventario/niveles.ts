/** Niveles de existencia y lista de compras — lógica pura, sin imports, para poder probarla.
 *
 *  Es lo que decide de qué color se pinta cada insumo y cuánto hay que comprar; si falla, falla
 *  en silencio y el negocio se queda sin producto o compra de más. */

export type NivelStock = "agotado" | "critico" | "bajo" | "ok" | "exceso";

export interface ExistenciaInsumo {
  insumoId: string;
  nombre: string;
  unidadMedida: string;
  existencia: number;
  minimo: number;
  maximo?: number | null;
  costoUnitario: number;
  proveedorNombre?: string | null;
}

/**
 * Nivel de un insumo respecto a su mínimo.
 *
 * Cinco niveles y no tres porque "por debajo del mínimo" no distingue entre quedarse corto
 * mañana y no poder vender hoy, y son dos urgencias muy distintas para quien hace la compra:
 *
 *  - `agotado`  existencia 0 → no se puede vender lo que lo lleva.
 *  - `critico`  al 50% del mínimo o menos → hay que comprar hoy.
 *  - `bajo`     por debajo del mínimo → entra en la lista de compras.
 *  - `exceso`   por encima del máximo, si está definido → dinero parado, o riesgo de caducidad.
 *  - `ok`       el resto.
 *
 * Un insumo sin mínimo configurado (0) nunca está bajo: no hay contra qué comparar, y pintarlo
 * en rojo llenaría la pantalla de falsas alarmas el primer día.
 */
export function nivelDe(item: ExistenciaInsumo): NivelStock {
  if (item.existencia <= 0) return "agotado";
  if (item.minimo > 0) {
    if (item.existencia <= item.minimo * 0.5) return "critico";
    if (item.existencia < item.minimo) return "bajo";
  }
  if (item.maximo != null && item.maximo > 0 && item.existencia > item.maximo) return "exceso";
  return "ok";
}

export const ETIQUETA_NIVEL: Record<NivelStock, string> = {
  agotado: "Agotado",
  critico: "Crítico",
  bajo: "Bajo mínimo",
  ok: "Suficiente",
  exceso: "Sobre el máximo",
};

/** Orden por urgencia, para que lo que hay que atender primero salga arriba sin tener que
 *  buscarlo entre cien insumos que están bien. */
const PRIORIDAD: Record<NivelStock, number> = { agotado: 0, critico: 1, bajo: 2, exceso: 3, ok: 4 };

export function ordenarPorUrgencia(items: ExistenciaInsumo[]): ExistenciaInsumo[] {
  return [...items].sort((a, b) => {
    const d = PRIORIDAD[nivelDe(a)] - PRIORIDAD[nivelDe(b)];
    return d !== 0 ? d : a.nombre.localeCompare(b.nombre);
  });
}

export interface LineaCompra {
  insumoId: string;
  nombre: string;
  unidadMedida: string;
  existencia: number;
  minimo: number;
  sugerido: number;
  costoEstimado: number;
  proveedorNombre: string;
  nivel: NivelStock;
}

/**
 * Lista de compras a partir del inventario. Entra todo lo que esté por debajo del mínimo
 * (incluido lo agotado); lo que está bien no aparece.
 *
 * Cuánto comprar: hasta el máximo si está definido, y si no hasta el doble del mínimo. Reponer
 * justo hasta el mínimo dejaría el insumo en la frontera, otra vez en la lista al día siguiente.
 *
 * La cantidad se redondea hacia ARRIBA: no se compra media caja, y quedarse corto es peor que
 * pasarse por una unidad.
 */
export function generarListaCompras(items: ExistenciaInsumo[]): LineaCompra[] {
  const lineas = items
    .filter((i) => {
      const n = nivelDe(i);
      return n === "agotado" || n === "critico" || n === "bajo";
    })
    .map((i) => {
      const objetivo = i.maximo != null && i.maximo > 0 ? i.maximo : i.minimo * 2;
      const sugerido = Math.max(0, Math.ceil(objetivo - i.existencia));
      return {
        insumoId: i.insumoId,
        nombre: i.nombre,
        unidadMedida: i.unidadMedida,
        existencia: i.existencia,
        minimo: i.minimo,
        sugerido,
        costoEstimado: Math.round(sugerido * (i.costoUnitario || 0) * 100) / 100,
        proveedorNombre: i.proveedorNombre?.trim() || "Sin proveedor asignado",
        nivel: nivelDe(i),
      };
    })
    // Un sugerido de 0 sale cuando el insumo está agotado y no tiene mínimo configurado: no hay
    // nada que pedir hasta que alguien le ponga un mínimo, y listarlo con "comprar 0" confunde.
    .filter((l) => l.sugerido > 0);

  return lineas.sort((a, b) => {
    const d = PRIORIDAD[a.nivel] - PRIORIDAD[b.nivel];
    if (d !== 0) return d;
    // Dentro de la misma urgencia, juntos por proveedor: así la lista se puede cortar y mandar
    // por partes, que es como se compra de verdad.
    const p = a.proveedorNombre.localeCompare(b.proveedorNombre);
    return p !== 0 ? p : a.nombre.localeCompare(b.nombre);
  });
}

/** Agrupa la lista por proveedor, que es como se manda un pedido. */
export function agruparPorProveedor(lineas: LineaCompra[]): { proveedor: string; lineas: LineaCompra[]; costo: number }[] {
  const mapa = new Map<string, LineaCompra[]>();
  for (const l of lineas) {
    const actual = mapa.get(l.proveedorNombre) ?? [];
    actual.push(l);
    mapa.set(l.proveedorNombre, actual);
  }
  return [...mapa.entries()]
    .map(([proveedor, ls]) => ({
      proveedor,
      lineas: ls,
      costo: Math.round(ls.reduce((s, l) => s + l.costoEstimado, 0) * 100) / 100,
    }))
    .sort((a, b) => a.proveedor.localeCompare(b.proveedor));
}

/** La diferencia de un conteo físico contra lo que el sistema creía tener. Positiva = sobra. */
export function diferenciaConteo(contado: number, existencia: number): number {
  return Math.round((contado - existencia) * 10000) / 10000;
}
