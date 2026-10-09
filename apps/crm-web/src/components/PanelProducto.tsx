"use client";

import { useEffect, useState } from "react";
import type { CategoriaProducto, EstacionPreparacion, Modificador, Producto, Sucursal } from "@hangar421/shared";
import { apiFetch } from "@/lib/api";

/**
 * Alta y edición de producto en el ERP con los mismos datos que pide la terminal
 * (Admin → Catálogo del APK): categoría (o una nueva), nombre, precio, subcategoría, estación de
 * preparación y los modificadores que debe preguntar (existentes, o un grupo nuevo creado aquí
 * mismo). En la alta además se elige en qué sucursales queda en venta.
 *
 * `producto` null = alta; con producto = edición (nombre, precio base, categoría, subcategoría,
 * estación y modificadores; el precio por sucursal se sigue manejando aparte).
 */
export function PanelProducto({ empresaId, producto, categorias, sucursales, sucursalActivaId, onCerrar, onGuardado, onCategoriaCreada }: {
  empresaId: string;
  producto: Producto | null;
  categorias: CategoriaProducto[];
  sucursales: Sucursal[];
  sucursalActivaId: string;
  onCerrar: () => void;
  onGuardado: () => void;
  onCategoriaCreada: () => void;
}) {
  const edicion = producto !== null;
  const [nombre, setNombre] = useState(producto?.nombre ?? "");
  const [precio, setPrecio] = useState(producto ? String(producto.precioBase) : "");
  const [categoriaId, setCategoriaId] = useState(producto?.categoriaId ?? categorias[0]?.id ?? "");
  const [subcategoria, setSubcategoria] = useState(producto?.subcategoria ?? "");
  const [estacion, setEstacion] = useState<EstacionPreparacion | "">(producto?.estacionPreparacion ?? "");
  const [modsSeleccionados, setModsSeleccionados] = useState<string[]>(producto?.modificadores?.map((m) => m.id) ?? []);
  const [enVenta, setEnVenta] = useState<Set<string>>(() => new Set(sucursales.map((s) => s.id)));

  const [modificadores, setModificadores] = useState<Modificador[]>([]);
  const [nuevaCategoria, setNuevaCategoria] = useState<string | null>(null);
  const [nuevoMod, setNuevoMod] = useState<{ nombre: string; tipo: "SELECCION_UNICA" | "MULTIPLE"; obligatorio: boolean; opciones: { nombre: string; precioExtra: string }[] } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Si la lista de sucursales llega después de abrir el panel, el "todas" inicial se completa.
  useEffect(() => { if (!edicion) setEnVenta(new Set(sucursales.map((s) => s.id))); }, [sucursales, edicion]);

  async function cargarModificadores() {
    setModificadores(await apiFetch<Modificador[]>(`/catalogo/modificadores?empresaId=${empresaId}`));
  }
  useEffect(() => { cargarModificadores().catch(() => setModificadores([])); // eslint-disable-line react-hooks/exhaustive-deps
  }, [empresaId]);

  function alternarMod(id: string) {
    setModsSeleccionados((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function crearCategoria() {
    const n = (nuevaCategoria ?? "").trim();
    if (!n) return;
    try {
      const cat = await apiFetch<CategoriaProducto>("/catalogo/categorias", {
        method: "POST",
        body: JSON.stringify({ empresaId, nombre: n, orden: categorias.length + 1 }),
      });
      setNuevaCategoria(null);
      setCategoriaId(cat.id);
      onCategoriaCreada();
    } catch (e: any) {
      setError(e?.message ?? "No se pudo crear la categoría");
    }
  }

  async function crearModificador() {
    if (!nuevoMod) return;
    const opciones = nuevoMod.opciones.map((o, i) => ({ nombre: o.nombre.trim(), precioExtra: Number(o.precioExtra) || 0, orden: i + 1 })).filter((o) => o.nombre);
    if (!nuevoMod.nombre.trim()) { setError("El modificador necesita nombre"); return; }
    if (opciones.length === 0) { setError("El modificador necesita al menos una opción"); return; }
    try {
      const creado = await apiFetch<Modificador>("/catalogo/modificadores", {
        method: "POST",
        body: JSON.stringify({ empresaId, nombre: nuevoMod.nombre.trim(), tipo: nuevoMod.tipo, obligatorio: nuevoMod.obligatorio, opciones }),
      });
      setNuevoMod(null);
      setError(null);
      await cargarModificadores();
      setModsSeleccionados((s) => [...s, creado.id]);
    } catch (e: any) {
      setError(e?.message ?? "No se pudo crear el modificador");
    }
  }

  async function guardar() {
    if (!nombre.trim()) { setError("Escribe el nombre del producto"); return; }
    if (!categoriaId) { setError("Elige una categoría"); return; }
    const precioBase = Number(precio);
    if (!Number.isFinite(precioBase) || precioBase < 0) { setError("El precio no es válido"); return; }
    setGuardando(true);
    setError(null);
    try {
      if (edicion && producto) {
        await apiFetch(`/catalogo/productos/${producto.id}`, {
          method: "PATCH",
          body: JSON.stringify({ nombre: nombre.trim(), precioBase, categoriaId, subcategoria: subcategoria.trim() || null, estacionPreparacion: estacion || null }),
        });
        await apiFetch(`/catalogo/productos/${producto.id}/modificadores`, { method: "PUT", body: JSON.stringify({ modificadorIds: modsSeleccionados }) });
      } else {
        await apiFetch("/catalogo/productos", {
          method: "POST",
          body: JSON.stringify({
            categoriaId, nombre: nombre.trim(), precioBase,
            subcategoria: subcategoria.trim() || null,
            estacionPreparacion: estacion || null,
            modificadorIds: modsSeleccionados,
            sucursalIds: sucursales.length > 0 ? [...enVenta] : undefined,
          }),
        });
      }
      onGuardado();
    } catch (e: any) {
      setError(e?.message ?? "No se pudo guardar el producto");
    } finally {
      setGuardando(false);
    }
  }

  const input: React.CSSProperties = { width: "100%", padding: 10, marginBottom: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)", boxSizing: "border-box" };
  const etiqueta: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: "var(--h421-gray-400)", margin: "6px 0 4px" };

  return (
    <div className="card" style={{ position: "sticky", top: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ marginTop: 0 }}>{edicion ? `Editar — ${producto?.nombre}` : "Nuevo producto"}</h3>
        <button onClick={onCerrar} style={{ background: "none", color: "var(--h421-gray-400)" }} aria-label="Cerrar">✕</button>
      </div>

      <div style={etiqueta}>Categoría</div>
      {nuevaCategoria === null ? (
        <div style={{ display: "flex", gap: 6 }}>
          <select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)} style={{ ...input, flex: 1 }}>
            <option value="">Categoría…</option>
            {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
          <button onClick={() => setNuevaCategoria("")} title="Crear una categoría nueva" style={{ background: "var(--h421-gray-50)", padding: "0 12px", marginBottom: 8, fontSize: 13, whiteSpace: "nowrap" }}>+ Nueva</button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 6 }}>
          <input autoFocus placeholder="Nombre de la categoría nueva" value={nuevaCategoria} onChange={(e) => setNuevaCategoria(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") crearCategoria(); if (e.key === "Escape") setNuevaCategoria(null); }} style={{ ...input, flex: 1 }} />
          <button onClick={crearCategoria} style={{ background: "var(--h421-green)", color: "#fff", padding: "0 12px", marginBottom: 8, fontSize: 13 }}>Crear</button>
          <button onClick={() => setNuevaCategoria(null)} style={{ background: "var(--h421-gray-200)", padding: "0 10px", marginBottom: 8, fontSize: 13 }}>✕</button>
        </div>
      )}

      <div style={etiqueta}>Nombre</div>
      <input placeholder="Nombre del producto" value={nombre} onChange={(e) => setNombre(e.target.value)} style={input} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>
          <div style={etiqueta}>Precio base</div>
          <input placeholder="0.00" type="number" min={0} step="0.5" value={precio} onChange={(e) => setPrecio(e.target.value)} style={input} />
        </div>
        <div>
          <div style={etiqueta}>Estación de preparación</div>
          <select value={estacion} onChange={(e) => setEstacion(e.target.value as EstacionPreparacion | "")} style={input}>
            <option value="">Sin asignar</option>
            <option value="BARRA">Barra</option>
            <option value="COCINA">Cocina</option>
            <option value="POSTRES">Postres</option>
          </select>
        </div>
      </div>

      <div style={etiqueta}>Subcategoría (opcional)</div>
      <input placeholder="Ej. De temporada, Frappés…" value={subcategoria} onChange={(e) => setSubcategoria(e.target.value)} style={input} />

      <div style={{ ...etiqueta, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>Modificadores que pregunta ({modsSeleccionados.length})</span>
        {nuevoMod === null && (
          <button onClick={() => setNuevoMod({ nombre: "", tipo: "SELECCION_UNICA", obligatorio: true, opciones: [{ nombre: "", precioExtra: "" }, { nombre: "", precioExtra: "" }] })}
            style={{ background: "var(--h421-gray-50)", padding: "4px 10px", fontSize: 12, minHeight: 0 }}>+ Nuevo modificador</button>
        )}
      </div>
      {modificadores.length === 0 && nuevoMod === null && (
        <p style={{ fontSize: 13, color: "var(--h421-gray-400)", margin: "0 0 8px" }}>Todavía no hay modificadores (tamaño, tipo de leche, extras…). Crea el primero con el botón de arriba.</p>
      )}
      <div style={{ maxHeight: 220, overflowY: "auto", border: modificadores.length ? "1px solid var(--h421-gray-200)" : "none", borderRadius: 8, marginBottom: 8 }}>
        {modificadores.map((m) => {
          const activo = modsSeleccionados.includes(m.id);
          return (
            <label key={m.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "8px 10px", borderBottom: "1px solid var(--h421-gray-200)", cursor: "pointer", background: activo ? "var(--h421-gray-50)" : "transparent" }}>
              <input type="checkbox" checked={activo} onChange={() => alternarMod(m.id)} style={{ marginTop: 3 }} />
              <span style={{ fontSize: 13 }}>
                <strong>{m.nombre}</strong>
                <span style={{ color: "var(--h421-gray-400)" }}> · {m.tipo === "MULTIPLE" ? "varias opciones" : "una opción"}{m.obligatorio ? ", obligatorio" : ""}</span>
                <div style={{ color: "var(--h421-gray-400)", fontSize: 12 }}>
                  {m.opciones.map((o) => (o.precioExtra > 0 ? `${o.nombre} (+$${o.precioExtra.toFixed(2)})` : o.nombre)).join(", ")}
                </div>
              </span>
            </label>
          );
        })}
      </div>

      {nuevoMod !== null && (
        <div style={{ border: "1px dashed var(--h421-navy)", borderRadius: 8, padding: 10, marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Nuevo modificador</div>
          <input placeholder="Nombre del grupo (Ej. Tamaño, Tipo de leche)" value={nuevoMod.nombre} onChange={(e) => setNuevoMod({ ...nuevoMod, nombre: e.target.value })} style={input} />
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 8, fontSize: 13 }}>
            <select value={nuevoMod.tipo} onChange={(e) => setNuevoMod({ ...nuevoMod, tipo: e.target.value as "SELECCION_UNICA" | "MULTIPLE" })} style={{ padding: 8, borderRadius: 8 }}>
              <option value="SELECCION_UNICA">Se elige una opción</option>
              <option value="MULTIPLE">Se pueden elegir varias</option>
            </select>
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" checked={nuevoMod.obligatorio} onChange={(e) => setNuevoMod({ ...nuevoMod, obligatorio: e.target.checked })} /> Obligatorio
            </label>
          </div>
          {nuevoMod.opciones.map((o, i) => (
            <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              <input placeholder={`Opción ${i + 1}`} value={o.nombre} onChange={(e) => setNuevoMod({ ...nuevoMod, opciones: nuevoMod.opciones.map((x, j) => (j === i ? { ...x, nombre: e.target.value } : x)) })} style={{ ...input, flex: 2, marginBottom: 0 }} />
              <input placeholder="+ $" type="number" min={0} value={o.precioExtra} onChange={(e) => setNuevoMod({ ...nuevoMod, opciones: nuevoMod.opciones.map((x, j) => (j === i ? { ...x, precioExtra: e.target.value } : x)) })} style={{ ...input, flex: 1, marginBottom: 0 }} />
              <button onClick={() => setNuevoMod({ ...nuevoMod, opciones: nuevoMod.opciones.filter((_, j) => j !== i) })} disabled={nuevoMod.opciones.length <= 1} style={{ background: "var(--h421-red-bg)", color: "var(--h421-red-texto)", padding: "0 10px", fontSize: 12 }}>✕</button>
            </div>
          ))}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button onClick={() => setNuevoMod({ ...nuevoMod, opciones: [...nuevoMod.opciones, { nombre: "", precioExtra: "" }] })} style={{ background: "var(--h421-gray-50)", padding: "6px 10px", fontSize: 12 }}>+ Opción</button>
            <button onClick={crearModificador} style={{ background: "var(--h421-navy)", color: "#fff", padding: "6px 12px", fontSize: 12 }}>Guardar modificador</button>
            <button onClick={() => setNuevoMod(null)} style={{ background: "var(--h421-gray-200)", padding: "6px 10px", fontSize: 12 }}>Cancelar</button>
          </div>
        </div>
      )}

      {!edicion && sucursales.length > 0 && (
        <>
          <div style={{ ...etiqueta, display: "flex", justifyContent: "space-between" }}>
            <span>En venta en</span>
            <span>
              <button onClick={() => setEnVenta(new Set(sucursales.map((s) => s.id)))} style={{ background: "none", color: "var(--h421-blue)", padding: "0 6px", fontSize: 12, minHeight: 0 }}>todas</button>
              <button onClick={() => setEnVenta(new Set(sucursalActivaId ? [sucursalActivaId] : []))} style={{ background: "none", color: "var(--h421-blue)", padding: "0 6px", fontSize: 12, minHeight: 0 }}>solo la actual</button>
            </span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 8, fontSize: 13 }}>
            {sucursales.map((s) => (
              <label key={s.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" checked={enVenta.has(s.id)} onChange={(e) => setEnVenta((prev) => { const n = new Set(prev); if (e.target.checked) n.add(s.id); else n.delete(s.id); return n; })} />
                {s.nombre}
              </label>
            ))}
          </div>
          <p style={{ fontSize: 12, color: "var(--h421-gray-400)", margin: "0 0 8px" }}>
            Donde no esté marcado queda en espera: allá se activa después con “Disponible” en esa sucursal.
          </p>
        </>
      )}

      {error && <p style={{ color: "var(--h421-red-texto)", fontSize: 13, margin: "4px 0 8px" }}>{error}</p>}

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={guardar} disabled={guardando} style={{ background: "var(--h421-green)", color: "#fff", padding: "10px 16px" }}>
          {guardando ? "Guardando…" : edicion ? "Guardar cambios" : "Crear producto"}
        </button>
        <button onClick={onCerrar} style={{ background: "var(--h421-gray-200)", padding: "10px 14px" }}>Cancelar</button>
      </div>
    </div>
  );
}
