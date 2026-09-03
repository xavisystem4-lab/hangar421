"use client";

import { useEffect, useState } from "react";
import type { CategoriaProducto, Producto, Sucursal } from "@hangar421/shared";
import { apiFetch } from "@/lib/api";
import { useAuthCrm } from "@/lib/authClient";

interface Insumo { id: string; nombre: string; unidadMedida: string }
interface RecetaItemDto { id: string; insumoId: string; cantidad: string; insumo: { nombre: string; unidadMedida: string } }

export default function CatalogoPage() {
  const { contexto } = useAuthCrm();
  const [categorias, setCategorias] = useState<CategoriaProducto[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [sucursalId, setSucursalId] = useState<string>("");
  const [nuevo, setNuevo] = useState({ nombre: "", categoriaId: "", precioBase: "" });

  const [insumos, setInsumos] = useState<Insumo[]>([]);
  const [productoReceta, setProductoReceta] = useState<Producto | null>(null);
  const [receta, setReceta] = useState<RecetaItemDto[]>([]);
  const [nuevoItem, setNuevoItem] = useState({ insumoId: "", cantidad: "" });

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

  useEffect(() => {
    if (!contexto) return;
    apiFetch<Sucursal[]>(`/sucursales?empresaId=${contexto.usuario.empresaId}`).then((s) => {
      setSucursales(s);
      const activa = s[0]?.id ?? "";
      setSucursalId(activa);
      if (activa) cargar(activa);
    });
    apiFetch<Insumo[]>(`/inventario/insumos?empresaId=${contexto.usuario.empresaId}`).then((ins) => {
      setInsumos(ins);
      if (ins[0]) setNuevoItem((n) => ({ ...n, insumoId: ins[0].id }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contexto]);

  async function crearProducto() {
    if (!contexto || !nuevo.nombre || !nuevo.categoriaId) return;
    await apiFetch("/catalogo/productos", {
      method: "POST",
      body: JSON.stringify({ empresaId: contexto.usuario.empresaId, categoriaId: nuevo.categoriaId, nombre: nuevo.nombre, precioBase: Number(nuevo.precioBase) }),
    });
    setNuevo({ nombre: "", categoriaId: "", precioBase: "" });
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
    setProductoReceta(p);
    const items = await apiFetch<RecetaItemDto[]>(`/inventario/productos/${p.id}/receta`);
    setReceta(items);
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
        <select value={sucursalId} onChange={(e) => { setSucursalId(e.target.value); cargar(e.target.value); }} style={{ padding: 8 }}>
          {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: productoReceta ? "1.6fr 1fr" : "1fr", gap: 16, alignItems: "start" }}>
        <div>
          {categorias.map((cat) => (
            <div key={cat.id} style={{ marginBottom: 20 }}>
              <h3>{cat.nombre}</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
                {productos.filter((p) => p.categoriaId === cat.id).map((p) => (
                  <div key={p.id} className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <div>
                      <strong>{p.nombre}</strong>
                      <div style={{ fontSize: 13, color: "var(--h421-gray-400)" }}>${(p.precioSucursal ?? p.precioBase).toFixed(2)}</div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <button
                        onClick={() => toggleDisponibilidad(p)}
                        style={{ background: p.disponibleSucursal !== false ? "var(--h421-green)" : "var(--h421-gray-200)", color: "#fff", padding: "6px 10px", fontSize: 12 }}
                      >
                        {p.disponibleSucursal !== false ? "Disponible" : "Agotado"}
                      </button>
                      <button onClick={() => abrirReceta(p)} style={{ background: "var(--h421-navy)", color: "#fff", padding: "6px 10px", fontSize: 12 }}>
                        Receta
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div className="card" style={{ maxWidth: 420 }}>
            <h3 style={{ marginTop: 0 }}>Nuevo producto</h3>
            <select value={nuevo.categoriaId} onChange={(e) => setNuevo((n) => ({ ...n, categoriaId: e.target.value }))}
              style={{ width: "100%", padding: 10, marginBottom: 8 }}>
              <option value="">Categoría…</option>
              {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            <input placeholder="Nombre" value={nuevo.nombre} onChange={(e) => setNuevo((n) => ({ ...n, nombre: e.target.value }))}
              style={{ width: "100%", padding: 10, marginBottom: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
            <input placeholder="Precio base" type="number" value={nuevo.precioBase} onChange={(e) => setNuevo((n) => ({ ...n, precioBase: e.target.value }))}
              style={{ width: "100%", padding: 10, marginBottom: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
            <button onClick={crearProducto} style={{ background: "var(--h421-green)", color: "#fff", padding: "10px 16px" }}>Crear producto</button>
          </div>
        </div>

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
                <button onClick={() => quitarItemReceta(r.id)} style={{ background: "#fee2e2", color: "var(--h421-red)", padding: "4px 8px", fontSize: 12 }}>Quitar</button>
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
