"use client";

import { useMemo, useState } from "react";
import type { NivelInventario, ResumenSemaforoInventario } from "@hangar421/shared";
import { calcularNivelInventario } from "@hangar421/shared";
import { ETIQUETA_NIVEL, SEMAFORO } from "@/components/ReporteInventario";

/** Lo que devuelve GET /inventario/productos-existencias: cuántas unidades de cada producto
 *  alcanzan con los insumos de la sucursal (según receta) y qué insumo lo limita. */
export interface ExistenciaProducto {
  productoId: string;
  nombre: string;
  categoriaId: string;
  categoria: string;
  disponibleEnSucursal: boolean;
  tieneReceta: boolean;
  porciones: number | null;
  limitante: { insumoId: string; nombre: string; unidadMedida: string; existencia: number; minimo: number; maximo: number | null; porUnidad: number } | null;
}

export interface FilaExistencia {
  insumo: { id: string; nombre: string; unidadMedida: string };
  existencia: number;
  minimo: number;
  maximo: number | null;
  nivel: NivelInventario;
  tieneExistencia: boolean;
}

const ORDEN_NIVEL: Record<NivelInventario, number> = { CRITICO: 0, BAJO: 1, OPTIMO: 2 };

function formatearCantidad(n: number): string {
  // Hasta 2 decimales, sin ceros de relleno: 12 → "12", 1.5 → "1.5", 0.333 → "0.33".
  return Number.isInteger(n) ? String(n) : n.toLocaleString("es-MX", { maximumFractionDigits: 2 });
}

/** Nivel de un producto = el del insumo que lo limita (si ese insumo está en rojo, el producto
 *  también); sin receta no hay forma de juzgarlo. Con 0 porciones siempre es rojo. */
function nivelProducto(p: ExistenciaProducto): NivelInventario | null {
  if (!p.tieneReceta || p.porciones === null) return null;
  if (p.porciones <= 0) return "CRITICO";
  if (!p.limitante) return "OPTIMO";
  return calcularNivelInventario(p.limitante.existencia, p.limitante.minimo, p.limitante.maximo).nivel;
}

/**
 * "Existencias ahora": la cantidad real de cada insumo (y de cada producto, en porciones que
 * alcanzan a prepararse) en grande, con el semáforo verde/amarillo/rojo. Las tres tarjetas de
 * arriba cuentan todo el inventario y, al tocarlas, filtran la lista (mismo filtro que el
 * selector de nivel de la barra de herramientas). Pensado para verse de un vistazo en la
 * sucursal y para armar la lista de compras.
 */
export function PanelExistencias({ filas, productos, resumen, filtroNivel, onFiltroNivel, busqueda, actualizadoEn, onActualizar, onListaCompras }: {
  filas: FilaExistencia[];
  productos: ExistenciaProducto[];
  resumen: ResumenSemaforoInventario;
  filtroNivel: "TODOS" | NivelInventario;
  onFiltroNivel: (nivel: "TODOS" | NivelInventario) => void;
  busqueda: string;
  actualizadoEn: Date | null;
  onActualizar: () => void;
  onListaCompras: () => void;
}) {
  const [pestana, setPestana] = useState<"insumos" | "productos">("insumos");
  const [verTodo, setVerTodo] = useState(false);

  const filasOrdenadas = useMemo(
    () => [...filas].sort((a, b) => ORDEN_NIVEL[a.nivel] - ORDEN_NIVEL[b.nivel] || a.insumo.nombre.localeCompare(b.insumo.nombre, "es")),
    [filas],
  );

  const productosFiltrados = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    return productos
      .map((p) => ({ ...p, nivel: nivelProducto(p) }))
      .filter((p) => (texto ? `${p.nombre} ${p.categoria}`.toLowerCase().includes(texto) : true))
      .filter((p) => (filtroNivel === "TODOS" ? true : p.nivel === filtroNivel))
      .sort((a, b) => {
        const oa = a.nivel ? ORDEN_NIVEL[a.nivel] : 3;
        const ob = b.nivel ? ORDEN_NIVEL[b.nivel] : 3;
        return oa - ob || (a.porciones ?? Infinity) - (b.porciones ?? Infinity) || a.nombre.localeCompare(b.nombre, "es");
      });
  }, [productos, busqueda, filtroNivel]);

  const conReceta = productos.filter((p) => p.tieneReceta).length;
  const LIMITE = 24;
  const listaInsumos = verTodo ? filasOrdenadas : filasOrdenadas.slice(0, LIMITE);
  const listaProductos = verTodo ? productosFiltrados : productosFiltrados.slice(0, LIMITE);
  const ocultos = pestana === "insumos" ? filasOrdenadas.length - listaInsumos.length : productosFiltrados.length - listaProductos.length;

  const tarjetaSemaforo = (nivel: NivelInventario, numero: number) => {
    const activo = filtroNivel === nivel;
    return (
      <button
        key={nivel}
        onClick={() => onFiltroNivel(activo ? "TODOS" : nivel)}
        title={activo ? "Quitar filtro" : `Ver solo ${ETIQUETA_NIVEL[nivel].toLowerCase()}`}
        style={{
          background: SEMAFORO[nivel].fondo, color: SEMAFORO[nivel].color, borderRadius: 12, padding: "12px 10px", textAlign: "center",
          border: activo ? `3px solid ${SEMAFORO[nivel].color}` : "3px solid transparent", cursor: "pointer", minHeight: 0,
        }}
      >
        <div style={{ fontSize: 40, fontWeight: 900, lineHeight: 1 }}>{numero}</div>
        <div style={{ fontSize: 11, fontWeight: 800, marginTop: 6, letterSpacing: 0.5 }}>{SEMAFORO[nivel].etiqueta}</div>
      </button>
    );
  };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 12 }}>
        <div style={{ flex: "1 1 220px" }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Existencias ahora</h2>
          <div style={{ fontSize: 12, color: "var(--h421-gray-400)" }}>
            {actualizadoEn ? `Actualizado a las ${actualizadoEn.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}` : "Cargando…"} · se refresca solo cada minuto
            {" "}<button onClick={onActualizar} style={{ background: "none", color: "var(--h421-blue)", padding: 0, minHeight: 0, fontSize: 12, textDecoration: "underline" }}>actualizar</button>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => setPestana("insumos")} style={{ background: pestana === "insumos" ? "var(--h421-navy)" : "var(--h421-gray-50)", color: pestana === "insumos" ? "#fff" : "inherit", padding: "8px 14px", fontSize: 13, fontWeight: 700 }}>
            Insumos ({filas.length})
          </button>
          <button onClick={() => setPestana("productos")} style={{ background: pestana === "productos" ? "var(--h421-navy)" : "var(--h421-gray-50)", color: pestana === "productos" ? "#fff" : "inherit", padding: "8px 14px", fontSize: 13, fontWeight: 700 }}>
            Productos ({productosFiltrados.length})
          </button>
        </div>
        {(resumen.bajo > 0 || resumen.critico > 0) && (
          <button onClick={onListaCompras} style={{ background: "var(--h421-red)", color: "#fff", padding: "8px 14px", fontSize: 13, fontWeight: 700 }}>
            🛒 Lista de compras ({resumen.bajo + resumen.critico})
          </button>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 14 }}>
        {tarjetaSemaforo("OPTIMO", resumen.optimo)}
        {tarjetaSemaforo("BAJO", resumen.bajo)}
        {tarjetaSemaforo("CRITICO", resumen.critico)}
      </div>

      {pestana === "insumos" ? (
        <>
          {listaInsumos.length === 0 && <p style={{ color: "var(--h421-gray-400)", fontSize: 13, margin: 0 }}>Sin insumos que coincidan con la búsqueda o el filtro.</p>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 10 }}>
            {listaInsumos.map((f) => {
              const s = SEMAFORO[f.nivel];
              return (
                <div key={f.insumo.id} style={{ background: s.fondo, borderLeft: `6px solid ${s.color}`, borderRadius: 10, padding: "10px 12px", color: "#111318" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.2, minHeight: 32, color: "#111318" }} title={f.insumo.nombre}>{f.insumo.nombre}</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 4 }}>
                    <span style={{ fontSize: 36, fontWeight: 900, color: s.color, lineHeight: 1 }}>{formatearCantidad(f.existencia)}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: s.color }}>{f.insumo.unidadMedida}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "#4b5563", marginTop: 4 }}>
                    {f.minimo > 0 ? `mínimo ${formatearCantidad(f.minimo)} ${f.insumo.unidadMedida}` : "sin mínimo capturado"} · <strong style={{ color: s.color }}>{ETIQUETA_NIVEL[f.nivel]}</strong>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <p style={{ fontSize: 12, color: "var(--h421-gray-400)", margin: "0 0 10px" }}>
            Porciones que alcanzan a prepararse con la existencia actual de los insumos de la receta de cada producto.
            {conReceta === 0 && " Ningún producto tiene receta todavía: captúrala en Catálogo → Receta para ver aquí cuántos alcanzan."}
          </p>
          {listaProductos.length === 0 && conReceta > 0 && <p style={{ color: "var(--h421-gray-400)", fontSize: 13, margin: 0 }}>Sin productos que coincidan con la búsqueda o el filtro.</p>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 10 }}>
            {listaProductos.map((p) => {
              const s = p.nivel ? SEMAFORO[p.nivel] : null;
              return (
                <div key={p.productoId} style={{ background: s?.fondo ?? "var(--h421-gray-50)", borderLeft: `6px solid ${s?.color ?? "var(--h421-gray-200)"}`, borderRadius: 10, padding: "10px 12px", color: "#111318", opacity: p.disponibleEnSucursal ? 1 : 0.6 }}>
                  <div style={{ fontSize: 11, color: "#6b7280" }}>{p.categoria}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.2, minHeight: 32, color: s ? "#111318" : "inherit" }} title={p.nombre}>{p.nombre}</div>
                  {p.porciones === null ? (
                    <div style={{ fontSize: 12, color: "var(--h421-gray-400)", marginTop: 6 }}>Sin receta</div>
                  ) : (
                    <>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 4 }}>
                        <span style={{ fontSize: 36, fontWeight: 900, color: s?.color, lineHeight: 1 }}>{p.porciones}</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: s?.color }}>{p.porciones === 1 ? "porción" : "porciones"}</span>
                      </div>
                      {p.limitante && (
                        <div style={{ fontSize: 11, color: "#4b5563", marginTop: 4 }} title={`Cada unidad lleva ${formatearCantidad(p.limitante.porUnidad)} ${p.limitante.unidadMedida}`}>
                          limita: {p.limitante.nombre} ({formatearCantidad(p.limitante.existencia)} {p.limitante.unidadMedida})
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {(ocultos > 0 || verTodo) && (
        <button onClick={() => setVerTodo((v) => !v)} style={{ marginTop: 12, background: "var(--h421-gray-50)", padding: "8px 14px", fontSize: 13 }}>
          {verTodo ? "Ver menos" : `Ver los ${ocultos} restantes`}
        </button>
      )}
    </div>
  );
}
