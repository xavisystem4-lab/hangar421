import type { VentaHub } from "@hangar421/shared";

/** Venta local con lo necesario para subirla (la forma que devuelve la consulta del servicio). */
export interface VentaLocal {
  id: string;
  folio: string;
  estado: string;
  createdAt: Date;
  tipo: string;
  canalOrigen: string;
  numComensales: number | null;
  notasGenerales: string | null;
  subtotal: unknown;
  impuesto: unknown;
  descuentoTotal: unknown;
  total: unknown;
  meseroId: string | null;
  cajeroId: string | null;
  mesero: { id: string; nombre: string } | null;
  cajero: { id: string; nombre: string } | null;
  dispositivo: { identificador: string; nombre: string; tipo: string } | null;
  items: {
    id: string;
    productoId: string;
    cantidad: number;
    precioUnitario: unknown;
    notas: string | null;
    producto: { nombre: string };
    modificadores: { id: string; opcionModificadorId: string; precioExtra: unknown }[];
  }[];
  pagos: { id: string; metodo: string; monto: unknown; referencia: string | null }[];
  descuentos: { id: string; tipo: string; valor: unknown; montoAplicado: unknown; motivo: string }[];
}

export interface Mapeos {
  productos: Map<string, string | null>;
  opciones: Map<string, string | null>;
  /** Solo los usuarios con equivalente o ya dados de alta en la nube. */
  usuarios: Map<string, string>;
}

export type ResultadoArmado =
  | { tipo: "LISTA"; venta: VentaHub; usuariosPorAlta: { id: string; nombre: string }[] }
  | { tipo: "ESPERA_MAPEO"; productosSinEquivalente: string[] };

/**
 * Traduce una venta local al paquete que acepta la nube (VentaHub).
 *
 * - Un producto sin equivalente detiene la venta entera (ESPERA_MAPEO): subirla sin él
 *   descuadraría la venta, y crear el producto en la nube está prohibido por la regla del negocio.
 *   Espera a que el admin lo relacione.
 * - Una opción de modificador sin equivalente se omite: su importe ya está en los totales.
 * - Un usuario sin equivalente viaja con su id local y se da de alta en la nube con ese mismo id
 *   (como hace el APK desde la fase A), para que la venta conserve a la persona.
 */
export function armarVentaHub(v: VentaLocal, m: Mapeos): ResultadoArmado {
  const sinEquivalente = [...new Set(v.items.filter((i) => !m.productos.get(i.productoId)).map((i) => i.producto.nombre))];
  if (sinEquivalente.length > 0) return { tipo: "ESPERA_MAPEO", productosSinEquivalente: sinEquivalente };

  const usuariosPorAlta = new Map<string, { id: string; nombre: string }>();
  const usuario = (id: string | null, persona: { id: string; nombre: string } | null): string | null => {
    if (!id) return null;
    const enNube = m.usuarios.get(id);
    if (enNube) return enNube;
    if (persona) usuariosPorAlta.set(id, { id, nombre: persona.nombre });
    return id;
  };

  const venta: VentaHub = {
    folioLocal: v.folio,
    estado: v.estado as VentaHub["estado"],
    creadaEn: v.createdAt.toISOString(),
    tipo: v.tipo,
    canalOrigen: v.canalOrigen,
    numComensales: v.numComensales,
    notasGenerales: v.notasGenerales,
    subtotal: Number(v.subtotal),
    impuesto: Number(v.impuesto),
    descuentoTotal: Number(v.descuentoTotal),
    total: Number(v.total),
    meseroId: usuario(v.meseroId, v.mesero),
    cajeroId: usuario(v.cajeroId, v.cajero),
    dispositivoOrigen: v.dispositivo ? { identificador: v.dispositivo.identificador, nombre: v.dispositivo.nombre, tipo: v.dispositivo.tipo } : null,
    items: v.items.map((i) => ({
      id: i.id,
      productoId: m.productos.get(i.productoId)!,
      cantidad: i.cantidad,
      precioUnitario: Number(i.precioUnitario),
      notas: i.notas,
      modificadores: i.modificadores
        .filter((md) => !!m.opciones.get(md.opcionModificadorId))
        .map((md) => ({ id: md.id, opcionModificadorId: m.opciones.get(md.opcionModificadorId)!, precioExtra: Number(md.precioExtra) })),
    })),
    pagos: v.pagos.map((p) => ({ id: p.id, metodo: p.metodo, monto: Number(p.monto), referencia: p.referencia })),
    descuentos: v.descuentos.map((d) => ({
      id: d.id,
      tipo: d.tipo,
      valor: Number(d.valor),
      montoAplicado: Number(d.montoAplicado),
      motivo: d.motivo,
    })),
  };
  return { tipo: "LISTA", venta, usuariosPorAlta: [...usuariosPorAlta.values()] };
}
