"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { CategoriaProducto, Producto, Sucursal } from "@hangar421/shared";
import { apiFetch } from "@/lib/api";
import { useAuthCrm } from "@/lib/authClient";
import { useSucursalActiva } from "@/store/sucursalActiva";
import { filtrarProductos } from "@/lib/catalogoFiltro";
import { PanelProducto } from "@/components/PanelProducto";

interface Insumo { id: string; nombre: string; unidadMedida: string }
interface RecetaItemDto { id: string; insumoId: string; cantidad: string; insumo: { nombre: string; unidadMedida: string } }

export default function CatalogoPage() {
  const { contexto } = useAuthCrm();
  const { seleccion } = useSucursalActiva();
  const [categorias, setCategorias] = useState<CategoriaProducto[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [sucursalId, setSucursalId] = useState<string>("");

  const [insumos, setInsumos] = useState<Insumo[]>([]);
  const [productoReceta, setProductoReceta] = useState<Producto | null>(null);
  const [receta, setReceta] = useState<RecetaItemDto[]>([]);
  const [nuevoItem, setNuevoItem] = useState({ insumoId: "", cantidad: "" });

  // Panel lateral de alta/edición de producto (mismos datos que pide la terminal: categoría,
  // nombre, precio, estación, modificadores). `undefined` = cerrado, `null` = alta, Producto = edición.
  // Se usa el mismo lugar que el panel de Receta: solo uno abierto a la vez.
  const [panelProducto, setPanelProducto] = useState<Producto | null | undefined>(undefined);

  // Buscador + filtro de categoría sobre la lista. Se filtra en el navegador (el catálogo
  // completo ya viene en una sola consulta) y la lista se agrupa por categoría para que con
  // "Todas" se vea el catálogo entero ordenado como en la terminal.
  const [busqueda, setBusqueda] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState<string>("");

  const productosFiltrados = useMemo(
    () => filtrarProductos(productos, filtroCategoria, busqueda),
    [productos, filtroCategoria, busqueda],
  );
  const grupos = useMemo(
    () => categorias
      .map((cat) => ({ cat, items: productosFiltrados.filter((p) => p.categoriaId === cat.id) }))
      .filter((g) => g.items.length > 0),
    [categorias, productosFiltrados],
  );
  const conteoPorCategoria = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of productos) m.set(p.categoriaId, (m.get(p.categoriaId) ?? 0) + 1);
    return m;
  }, [productos]);

  async function cargar(suc: string) {
    if (!contexto) return;
    const empresaId = contexto.usuario.empresaId;
    const [cats, prods] = await Promise.all([
      apiFetch<CategoriaProducto[]>(`/catalogo/categorias?empresaId=${empresaId}`),
      apiFetch<Producto[]>(`/catalogo/productos?empresaId=${empresaId}&sucursalId=${suc}`),
    ]);
    setCategorias(cats);
    setProductos(prods);
  }

  // La sucursal viene del contexto global (cabecera). Recargar cuando cambia es lo que hace
  // que el ERP entero siga la misma sucursal sin que cada página tenga su propio selector.
  useEffect(() => {
    if (!contexto || !seleccion?.sucursalId) return;
    setSucursalId(seleccion.sucursalId);
    cargar(seleccion.sucursalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contexto, seleccion?.sucursalId]);

  // Sucursales de la empresa: para elegir dónde queda en venta un producto nuevo.
  useEffect(() => {
    if (!contexto) return;
    apiFetch<Sucursal[]>(`/sucursales?empresaId=${contexto.usuario.empresaId}`).then((s) => setSucursales(s.filter((x) => x.activo !== false))).catch(() => setSucursales([]));
  }, [contexto]);

  function abrirAlta() {
    setProductoReceta(null);
    setPanelProducto(null);
  }

  function abrirEdicion(p: Producto) {
    setProductoReceta(null);
    setPanelProducto(p);
  }

  // Baja lógica (activo: false) — nunca se borra el registro en sí, para no perder el historial
  // de pedidos/recetas que ya lo referencian (mismo patrón que "Disponible/Agotado" por
  // sucursal, pero esto lo oculta del catálogo completo, no solo de una sucursal).
  async function eliminarProducto(p: Producto) {
    if (!confirm(`¿Eliminar "${p.nombre}"? Ya no aparecerá en el catálogo (el historial de pedidos que ya lo usan no se pierde).`)) return;
    await apiFetch(`/catalogo/productos/${p.id}`, { method: "PATCH", body: JSON.stringify({ activo: false }) });
    cargar(sucursalId);
  }

  async function toggleDisponibilidad(p: Producto) {
    await apiFetch(`/catalogo/productos/${p.id}/disponibilidad`, {
      method: "PATCH",
      body: JSON.stringify({ sucursalId, disponible: !p.disponibleSucursal }),
    });
    cargar(sucursalId);
  }

  async function abrirReceta(p: Producto) {
    setPanelProducto(undefined);
    setProductoReceta(p);
    // Los insumos se piden al abrir la receta (antes nunca se cargaban y el panel siempre
    // decía "No hay insumos dados de alta" aunque sí los hubiera).
    const [items, lista] = await Promise.all([
      apiFetch<RecetaItemDto[]>(`/inventario/productos/${p.id}/receta`),
      contexto ? apiFetch<Insumo[]>(`/inventario/insumos?empresaId=${contexto.usuario.empresaId}`).catch(() => [] as Insumo[]) : Promise.resolve([] as Insumo[]),
    ]);
    setReceta(items);
    setInsumos(lista);
    setNuevoItem((n) => ({ ...n, insumoId: n.insumoId || lista[0]?.id || "" }));
  }

  async function agregarItemReceta() {
    if (!productoReceta || !nuevoItem.insumoId || !nuevoItem.cantidad) return;
    await apiFetch(`/inventario/productos/${productoReceta.id}/receta`, {
      method: "POST",
      body: JSON.stringify({ items: [{ insumoId: nuevoItem.insumoId, cantidad: Number(nuevoItem.cantidad) }] }),
    });
    setNuevoItem((n) => ({ ...n, cantidad: "" }));
    const items = await apiFetch<RecetaItemDto[]>(`/inventario/productos/${productoReceta.id}/receta`);
    setReceta(items);
  }

  async function quitarItemReceta(id: string) {
    await apiFetch(`/inventario/receta/${id}`, { method: "DELETE" });
    setReceta((r) => r.filter((x) => x.id !== id));
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ marginTop: 0 }}>Catálogo</h1>
        {/* Sin selector propio: la sucursal la fija el contexto global de la cabecera. Tener
            uno por página era lo que hacía perder la elección al navegar entre módulos. */}
        <button onClick={abrirAlta} style={{ background: "var(--h421-green)", color: "#fff", padding: "10px 16px" }}>+ Nuevo producto</button>
      </div>

      <div className="h421-grid-2col" style={{ display: "grid", gridTemplateColumns: productoReceta || panelProducto !== undefined ? "1.6fr 1fr" : "1fr", gap: 16, alignItems: "start" }}>
        <div>
          {/* Barra de herramientas: buscador + categoría, mismo layout que Inventario. */}
          <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 16 }}>
            <input
              placeholder="Buscar producto…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              style={{ flex: "1 1 220px", padding: 10, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }}
            />
            <select value={filtroCategoria} onChange={(e) => setFiltroCategoria(e.target.value)} style={{ padding: 10, borderRadius: 8 }}>
              <option value="">Todas las categorías ({productos.length})</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre} ({conteoPorCategoria.get(c.id) ?? 0})</option>
              ))}
            </select>
            {(busqueda || filtroCategoria) && (
              <button onClick={() => { setBusqueda(""); setFiltroCategoria(""); }} style={{ background: "var(--h421-gray-200)", padding: "10px 14px", fontSize: 13 }}>
                Limpiar
              </button>
            )}
            <span style={{ fontSize: 13, color: "var(--h421-gray-400)", marginLeft: "auto" }}>
              {productosFiltrados.length} de {productos.length} productos
            </span>
          </div>

          <div className="card h421-tabla-wrap" style={{ overflowX: "auto", marginBottom: 16 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid var(--h421-gray-200)" }}>
                  <th style={{ padding: 8 }}>Producto</th>
                  <th style={{ padding: 8 }}>Categoría</th>
                  <th style={{ padding: 8, textAlign: "right" }}>Precio</th>
                  <th style={{ padding: 8 }}>Modificadores</th>
                  <th style={{ padding: 8 }}>Estado</th>
                  <th style={{ padding: 8 }}></th>
                </tr>
              </thead>
              <tbody>
                {grupos.map(({ cat, items }) => (
                  <FilasCategoria key={cat.id} nombre={cat.nombre} total={items.length} mostrarEncabezado={!filtroCategoria}>
                    {items.map((p) => (
                      <tr key={p.id} style={{ borderBottom: "1px solid var(--h421-gray-200)", background: productoReceta?.id === p.id || panelProducto?.id === p.id ? "var(--h421-gray-50)" : "transparent" }}>
                        <td style={{ padding: 8 }}>
                          <strong>{p.nombre}</strong>
                          {p.subcategoria && <div style={{ fontSize: 12, color: "var(--h421-gray-400)" }}>{p.subcategoria}</div>}
                        </td>
                        <td style={{ padding: 8, color: "var(--h421-gray-400)" }}>{cat.nombre}</td>
                        <td style={{ padding: 8, textAlign: "right", whiteSpace: "nowrap" }}>
                          ${(p.precioSucursal ?? p.precioBase).toFixed(2)}
                          {p.precioSucursal != null && p.precioSucursal !== p.precioBase && (
                            <div style={{ fontSize: 11, color: "var(--h421-gray-400)" }} title="Precio base del catálogo; esta sucursal tiene su propio precio">
                              base ${p.precioBase.toFixed(2)}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: 8, fontSize: 12, color: "var(--h421-gray-400)", maxWidth: 220 }}>
                          {p.modificadores && p.modificadores.length > 0 ? p.modificadores.map((m) => m.nombre).join(", ") : "—"}
                        </td>
                        <td style={{ padding: 8 }}>
                          <button
                            onClick={() => toggleDisponibilidad(p)}
                            title="Cambiar disponibilidad en esta sucursal"
                            style={{ background: p.disponibleSucursal !== false ? "var(--h421-green)" : "var(--h421-gray-200)", color: p.disponibleSucursal !== false ? "#fff" : "inherit", padding: "6px 10px", fontSize: 12 }}
                          >
                            {p.disponibleSucursal !== false ? "Disponible" : "Agotado"}
                          </button>
                        </td>
                        <td style={{ padding: 8 }}>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            <button onClick={() => abrirReceta(p)} style={{ background: "var(--h421-navy)", color: "#fff", padding: "6px 10px", fontSize: 12 }}>
                              Receta
                            </button>
                            <button onClick={() => abrirEdicion(p)} style={{ background: "var(--h421-gray-50)", padding: "6px 10px", fontSize: 12 }}>
                              Editar
                            </button>
                            <button onClick={() => eliminarProducto(p)} style={{ background: "var(--h421-red-bg)", color: "var(--h421-red-texto)", padding: "6px 10px", fontSize: 12 }}>
                              Eliminar
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </FilasCategoria>
                ))}
                {productosFiltrados.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ padding: 16, color: "var(--h421-gray-400)", textAlign: "center" }}>
                      {productos.length === 0 ? "Sin productos en el catálogo." : "Ningún producto coincide con la búsqueda."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {panelProducto !== undefined && contexto && (
          <PanelProducto
            key={panelProducto?.id ?? "nuevo"}
            empresaId={contexto.usuario.empresaId}
            producto={panelProducto}
            categorias={categorias}
            sucursales={sucursales}
            sucursalActivaId={sucursalId}
            onCerrar={() => setPanelProducto(undefined)}
            onGuardado={() => { setPanelProducto(undefined); cargar(sucursalId); }}
            onCategoriaCreada={() => cargar(sucursalId)}
          />
        )}

        {productoReceta && (
          <div className="card" style={{ position: "sticky", top: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ marginTop: 0 }}>Receta — {productoReceta.nombre}</h3>
              <button onClick={() => setProductoReceta(null)} style={{ background: "none", color: "var(--h421-gray-400)" }}>✕</button>
            </div>
            <p style={{ fontSize: 12, color: "var(--h421-gray-400)", marginTop: -6 }}>
              Las cantidades definidas aquí se descuentan solas del inventario cada vez que se vende este producto.
            </p>

            {receta.length === 0 && <p style={{ color: "var(--h421-gray-400)", fontSize: 13 }}>Sin ingredientes definidos todavía.</p>}
            {receta.map((r) => (
              <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--h421-gray-200)", fontSize: 14 }}>
                <span>{r.insumo.nombre} — {r.cantidad} {r.insumo.unidadMedida}</span>
                <button onClick={() => quitarItemReceta(r.id)} style={{ background: "var(--h421-red-bg)", color: "var(--h421-red-texto)", padding: "4px 8px", fontSize: 12 }}>Quitar</button>
              </div>
            ))}

            {insumos.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--h421-gray-400)", marginTop: 10 }}>
                No hay insumos dados de alta — créalos primero en <strong>Inventario</strong>.
              </p>
            ) : (
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <select value={nuevoItem.insumoId} onChange={(e) => setNuevoItem((n) => ({ ...n, insumoId: e.target.value }))} style={{ flex: 2, padding: 8 }}>
                  {insumos.map((i) => <option key={i.id} value={i.id}>{i.nombre}</option>)}
                </select>
                <input placeholder="Cantidad" type="number" value={nuevoItem.cantidad} onChange={(e) => setNuevoItem((n) => ({ ...n, cantidad: e.target.value }))}
                  style={{ flex: 1, padding: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
                <button onClick={agregarItemReceta} style={{ background: "var(--h421-green)", color: "#fff", padding: "0 14px" }}>+</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Fila de encabezado de categoría dentro de la tabla (solo cuando se ven todas las categorías;
 *  si ya se filtró por una, la columna "Categoría" basta y el encabezado sería ruido). */
function FilasCategoria({ nombre, total, mostrarEncabezado, children }: { nombre: string; total: number; mostrarEncabezado: boolean; children: ReactNode }) {
  return (
    <>
      {mostrarEncabezado && (
        <tr style={{ background: "var(--h421-gray-50)" }}>
          <td colSpan={6} style={{ padding: "8px 8px 6px", fontWeight: 700, fontSize: 13, letterSpacing: 0.3, textTransform: "uppercase", color: "var(--h421-navy)" }}>
            {nombre} <span style={{ fontWeight: 400, color: "var(--h421-gray-400)" }}>({total})</span>
          </td>
        </tr>
      )}
      {children}
    </>
  );
}
