"use client";

import { useState } from "react";
import { NOMBRE_UNIDAD, UNIDADES_INSUMO, agruparPorSeccion, type UnidadInsumo } from "@hangar421/shared";
import { apiFetch } from "@/lib/api";

/** Insumo tal como lo devuelve GET /inventario/insumos (solo lo que este panel usa). */
export interface InsumoParaPreparacion {
  id: string;
  nombre: string;
  unidadMedida: string;
  esPreparacion?: boolean;
}

interface LineaReceta {
  insumoId: string;
  cantidad: string;
}

/** "lb · libras" para el selector; servicio y unidad ya van completas. */
/** Opciones de un <select> de insumos agrupadas por sección (Leches, Jarabes, Limpieza…), para
 *  encontrar rápido el insumo en listas largas. */
export function OpcionesInsumo({ insumos }: { insumos: { id: string; nombre: string; unidadMedida: string; esPreparacion?: boolean | null }[] }) {
  return (
    <>
      {agruparPorSeccion(insumos).map((g) => (
        <optgroup key={g.seccion} label={g.seccion}>
          {g.items.map((i) => <option key={i.id} value={i.id}>{i.nombre} ({i.unidadMedida}){i.esPreparacion ? " · preparación" : ""}</option>)}
        </optgroup>
      ))}
    </>
  );
}

export function etiquetaUnidad(u: string): string {
  const nombre = NOMBRE_UNIDAD[u as UnidadInsumo];
  return nombre && nombre !== u ? `${u} · ${nombre}` : u;
}

/**
 * Preparaciones de la casa: cold foam, crema batida saborizada, jarabes propios…
 *
 * Una preparación es un insumo que NO se compra: se hace con otros insumos. Se le escribe su
 * receta por UNA unidad (1 servicio de Cold foam blue matcha = 35 g crema batida + 15 g agave +
 * 2 g blue matcha) y después se usa como cualquier insumo en la receta de un producto o de una
 * opción de modificador (Catálogo → Receta). Al vender, el ERP y la tablet descuentan sus
 * ingredientes, no la preparación.
 */
export function PanelPreparaciones({
  empresaId,
  insumos,
  onCambio,
}: {
  empresaId: string;
  /** Todos los insumos activos, incluidas las preparaciones. */
  insumos: InsumoParaPreparacion[];
  onCambio: () => void;
}) {
  const preparaciones = insumos.filter((i) => i.esPreparacion);
  const [nueva, setNueva] = useState({ nombre: "", unidadMedida: "servicio" });
  const [abierta, setAbierta] = useState<string | null>(null);
  const [receta, setReceta] = useState<LineaReceta[]>([]);
  const [agregar, setAgregar] = useState<LineaReceta>({ insumoId: "", cantidad: "" });
  const [aviso, setAviso] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const nombreDe = (id: string) => insumos.find((i) => i.id === id);

  async function crear() {
    const nombre = nueva.nombre.trim();
    if (!nombre) return;
    if (insumos.some((i) => i.nombre.trim().toLowerCase() === nombre.toLowerCase())) {
      setAviso(`Ya existe "${nombre}" en el inventario.`);
      return;
    }
    const creada = await apiFetch<{ id: string }>("/inventario/insumos", {
      method: "POST",
      body: JSON.stringify({ empresaId, nombre, unidadMedida: nueva.unidadMedida, esPreparacion: true }),
    });
    setNueva({ nombre: "", unidadMedida: "servicio" });
    setAviso(`"${nombre}" creada. Ahora escribe sus ingredientes.`);
    onCambio();
    abrir(creada.id);
  }

  async function abrir(id: string) {
    if (abierta === id) {
      setAbierta(null);
      return;
    }
    setAbierta(id);
    setAgregar({ insumoId: "", cantidad: "" });
    const filas = await apiFetch<{ insumoId: string; cantidad: string | number }[]>(`/inventario/preparaciones/${id}/receta`).catch(() => []);
    setReceta(filas.map((f) => ({ insumoId: f.insumoId, cantidad: String(Number(f.cantidad)) })));
  }

  function agregarLinea() {
    if (!agregar.insumoId || !(Number(agregar.cantidad) > 0)) return;
    setReceta((r) => [...r.filter((l) => l.insumoId !== agregar.insumoId), agregar]);
    setAgregar({ insumoId: "", cantidad: "" });
  }

  async function guardar(id: string) {
    setGuardando(true);
    try {
      await apiFetch(`/inventario/preparaciones/${id}/receta`, {
        method: "POST",
        body: JSON.stringify({ items: receta.filter((l) => Number(l.cantidad) > 0).map((l) => ({ insumoId: l.insumoId, cantidad: Number(l.cantidad) })) }),
      });
      setAviso("Receta guardada. Las tablets la reciben en su siguiente descarga (máx. 5 min).");
      onCambio();
    } catch (e: any) {
      setAviso(e?.message ?? "No se pudo guardar la receta.");
    } finally {
      setGuardando(false);
    }
  }

  const estiloInput = { padding: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" } as const;

  return (
    <div className="card">
      <h3 style={{ marginTop: 0, marginBottom: 4 }}>Preparaciones de la casa</h3>
      <p style={{ marginTop: 0, fontSize: 12, color: "var(--h421-gray-500)" }}>
        Cold foam, cremas, jarabes propios… Escribe sus ingredientes por <b>1 unidad</b> y úsala en la receta de una bebida
        o de un modificador (Catálogo → Receta). Al vender se descuentan sus ingredientes.
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input placeholder="Nombre (ej. Cold foam blue matcha)" value={nueva.nombre}
          onChange={(e) => setNueva((n) => ({ ...n, nombre: e.target.value }))} style={{ ...estiloInput, flex: 1 }} />
        <select value={nueva.unidadMedida} onChange={(e) => setNueva((n) => ({ ...n, unidadMedida: e.target.value }))} style={estiloInput} title="Se mide en">
          {UNIDADES_INSUMO.map((u) => <option key={u} value={u}>{etiquetaUnidad(u)}</option>)}
        </select>
        <button onClick={crear} disabled={!nueva.nombre.trim()} style={{ background: "var(--h421-green)", color: "#fff", padding: "8px 14px" }}>Crear</button>
      </div>

      {aviso && <div style={{ fontSize: 12, marginBottom: 8, color: "var(--h421-blue)" }}>{aviso}</div>}

      {preparaciones.length === 0 && (
        <div style={{ fontSize: 13, color: "var(--h421-gray-500)" }}>Todavía no hay preparaciones.</div>
      )}

      {preparaciones.map((p) => (
        <div key={p.id} style={{ borderTop: "1px solid var(--h421-gray-200)", padding: "8px 0" }}>
          <button onClick={() => abrir(p.id)}
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontWeight: 700, fontSize: 14, textAlign: "left", width: "100%" }}>
            {abierta === p.id ? "▾" : "▸"} {p.nombre} <span style={{ fontWeight: 400, color: "var(--h421-gray-500)" }}>· por 1 {p.unidadMedida}</span>
          </button>

          {abierta === p.id && (
            <div style={{ marginTop: 8 }}>
              {receta.length === 0 && <div style={{ fontSize: 12, color: "var(--h421-gray-500)", marginBottom: 6 }}>Sin ingredientes todavía.</div>}
              {receta.map((l) => {
                const ins = nombreDe(l.insumoId);
                return (
                  <div key={l.insumoId} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                    <input type="number" min={0} step="any" value={l.cantidad}
                      onChange={(e) => setReceta((r) => r.map((x) => (x.insumoId === l.insumoId ? { ...x, cantidad: e.target.value } : x)))}
                      style={{ ...estiloInput, width: 90 }} />
                    <span style={{ fontSize: 13, minWidth: 30 }}>{ins?.unidadMedida ?? ""}</span>
                    <span style={{ flex: 1, fontSize: 13 }}>{ins?.nombre ?? "(insumo dado de baja)"}</span>
                    <button onClick={() => setReceta((r) => r.filter((x) => x.insumoId !== l.insumoId))} title="Quitar" style={{ background: "none", color: "var(--h421-red)", padding: "4px 8px" }}>✕</button>
                  </div>
                );
              })}

              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <select value={agregar.insumoId} onChange={(e) => setAgregar((a) => ({ ...a, insumoId: e.target.value }))} style={{ ...estiloInput, flex: 1 }}>
                  <option value="">Ingrediente…</option>
                  <OpcionesInsumo insumos={insumos.filter((i) => i.id !== p.id && !receta.some((l) => l.insumoId === i.id))} />
                </select>
                <input type="number" min={0} step="any" placeholder={nombreDe(agregar.insumoId)?.unidadMedida ?? "cantidad"} value={agregar.cantidad}
                  onChange={(e) => setAgregar((a) => ({ ...a, cantidad: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter") agregarLinea(); }}
                  style={{ ...estiloInput, width: 100 }} />
                <button onClick={agregarLinea} style={{ background: "var(--h421-blue)", color: "#fff", padding: "8px 14px" }}>Agregar</button>
              </div>

              <button style={{ marginTop: 10, background: "var(--h421-navy)", color: "#fff", padding: "8px 14px" }} onClick={() => guardar(p.id)} disabled={guardando}>
                {guardando ? "Guardando…" : "Guardar receta"}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
