"use client";

import { useEffect, useState } from "react";
import type { CategoriaProducto, Producto, Sucursal } from "@hangar421/shared";
import { apiFetch } from "@/lib/api";
import { useAuthCrm } from "@/lib/authClient";

export default function CatalogoPage() {
  const { contexto } = useAuthCrm();
  const [categorias, setCategorias] = useState<CategoriaProducto[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [sucursalId, setSucursalId] = useState<string>("");
  const [nuevo, setNuevo] = useState({ nombre: "", categoriaId: "", precioBase: "" });

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

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ marginTop: 0 }}>Catálogo</h1>
        <select value={sucursalId} onChange={(e) => { setSucursalId(e.target.value); cargar(e.target.value); }} style={{ padding: 8 }}>
          {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
      </div>

      {categorias.map((cat) => (
        <div key={cat.id} style={{ marginBottom: 20 }}>
          <h3>{cat.nombre}</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
            {productos.filter((p) => p.categoriaId === cat.id).map((p) => (
              <div key={p.id} className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <strong>{p.nombre}</strong>
                  <div style={{ fontSize: 13, color: "var(--h421-gray-400)" }}>${(p.precioSucursal ?? p.precioBase).toFixed(2)}</div>
                </div>
                <button
                  onClick={() => toggleDisponibilidad(p)}
                  style={{ background: p.disponibleSucursal !== false ? "var(--h421-green)" : "var(--h421-gray-200)", color: "#fff", padding: "6px 10px", fontSize: 12 }}
                >
                  {p.disponibleSucursal !== false ? "Disponible" : "Agotado"}
                </button>
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
  );
}
