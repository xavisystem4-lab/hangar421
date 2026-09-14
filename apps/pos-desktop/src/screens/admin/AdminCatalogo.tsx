import { useEffect, useState } from "react";
import type { CategoriaProducto, Producto } from "@hangar421/shared";
import { apiFetch } from "../../api/http";
import { useAuthStore } from "../../store/authStore";

interface Insumo { id: string; nombre: string; unidadMedida: string }
interface RecetaItemDto { id: string; insumoId: string; cantidad: string; insumo: { nombre: string; unidadMedida: string } }

/** Alta, edición y baja de productos/categorías + receta (qué insumos descuenta cada venta) —
 *  mismo módulo que apps/crm-web/catalogo, dentro del propio POS. Antes esto solo se podía
 *  administrar desde el sistema web; el POS no tenía ninguna pantalla de catálogo. */
export function AdminCatalogo() {
  const { usuario, sucursalId } = useAuthStore();
  const [categorias, setCategorias] = useState<CategoriaProducto[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [nuevo, setNuevo] = useState({ nombre: "", categoriaId: "", precioBase: "" });

  const [insumos, setInsumos] = useState<Insumo[]>([]);
  const [productoReceta, setProductoReceta] = useState<Producto | null>(null);
  const [receta, setReceta] = useState<RecetaItemDto[]>([]);
  const [nuevoItem, setNuevoItem] = useState({ insumoId: "", cantidad: "" });

  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [borrador, setBorrador] = useState({ nombre: "", precioBase: "" });

  async function cargar() {
    if (!usuario || !sucursalId) return;
    const [cats, prods] = await Promise.all([
      apiFetch<CategoriaProducto[]>(`/catalogo/categorias?empresaId=${usuario.empresaId}`),
      apiFetch<Producto[]>(`/catalogo/productos?empresaId=${usuario.empresaId}&sucursalId=${sucursalId}`),
    ]);
    setCategorias(cats);
    setProductos(prods);
  }

  useEffect(() => {
    if (!usuario) return;
    cargar();
    apiFetch<Insumo[]>(`/inventario/insumos?empresaId=${usuario.empresaId}`).then((ins) => {
      setInsumos(ins);
      if (ins[0]) setNuevoItem((n) => ({ ...n, insumoId: ins[0].id }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario, sucursalId]);

  async function crearProducto() {
    if (!usuario || !nuevo.nombre || !nuevo.categoriaId) return;
    await apiFetch("/catalogo/productos", {
      method: "POST",
      body: JSON.stringify({ empresaId: usuario.empresaId, categoriaId: nuevo.categoriaId, nombre: nuevo.nombre, precioBase: Number(nuevo.precioBase) }),
    });
    setNuevo({ nombre: "", categoriaId: "", precioBase: "" });
    cargar();
  }

  function empezarEdicion(p: Producto) {
    setEditandoId(p.id);
    setBorrador({ nombre: p.nombre, precioBase: String(p.precioBase) });
  }

  async function guardarEdicion(id: string) {
    if (!borrador.nombre.trim()) return;
    await apiFetch(`/catalogo/productos/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ nombre: borrador.nombre, precioBase: Number(borrador.precioBase) }),
    });
    setEditandoId(null);
    cargar();
  }

  async function eliminarProducto(p: Producto) {
    if (!confirm(`¿Eliminar "${p.nombre}"? Ya no aparecerá en el catálogo (el historial de pedidos que ya lo usan no se pierde).`)) return;
    await apiFetch(`/catalogo/productos/${p.id}`, { method: "PATCH", body: JSON.stringify({ activo: false }) });
    cargar();
  }

  async function toggleDisponibilidad(p: Producto) {
    if (!sucursalId) return;
    await apiFetch(`/catalogo/productos/${p.id}/disponibilidad`, {
      method: "PATCH",
      body: JSON.stringify({ sucursalId, disponible: !p.disponibleSucursal }),
    });
    cargar();
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
      <h2 style={{ margin: "0 0 12px" }}>Catálogo</h2>

      <div style={{ display: "grid", gridTemplateColumns: productoReceta ? "1.6fr 1fr" : "1fr", gap: 16, alignItems: "start" }}>
        <div>
          {categorias.map((cat) => (
            <div key={cat.id} style={{ marginBottom: 20 }}>
              <h3>{cat.nombre}</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
                {productos.filter((p) => p.categoriaId === cat.id).map((p) => (
                  <div key={p.id} className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    {editandoId === p.id ? (
                      <div style={{ flex: 1 }}>
                        <input value={borrador.nombre} onChange={(e) => setBorrador((b) => ({ ...b, nombre: e.target.value }))}
                          style={{ width: "100%", padding: 6, marginBottom: 4, borderRadius: 6, border: "1px solid var(--h421-gray-200)" }} />
                        <input type="number" value={borrador.precioBase} onChange={(e) => setBorrador((b) => ({ ...b, precioBase: e.target.value }))}
                          style={{ width: "100%", padding: 6, borderRadius: 6, border: "1px solid var(--h421-gray-200)" }} />
                      </div>
                    ) : (
                      <div>
                        <strong>{p.nombre}</strong>
                        <div style={{ fontSize: 13, color: "var(--h421-gray-400)" }}>${(p.precioSucursal ?? p.precioBase).toFixed(2)}</div>
                      </div>
                    )}
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {editandoId === p.id ? (
                        <>
                          <button onClick={() => guardarEdicion(p.id)} style={{ background: "var(--h421-esmeralda)", color: "#fff", padding: "6px 10px", fontSize: 12, minHeight: 0 }}>
                            Guardar
                          </button>
                          <button onClick={() => setEditandoId(null)} style={{ background: "var(--h421-gray-200)", padding: "6px 10px", fontSize: 12, minHeight: 0 }}>
                            Cancelar
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => toggleDisponibilidad(p)}
                            style={{ background: p.disponibleSucursal !== false ? "var(--h421-green)" : "var(--h421-gray-200)", color: "#fff", padding: "6px 10px", fontSize: 12, minHeight: 0 }}
                          >
                            {p.disponibleSucursal !== false ? "Disponible" : "Agotado"}
                          </button>
                          <button onClick={() => abrirReceta(p)} style={{ background: "var(--h421-navy)", color: "#fff", padding: "6px 10px", fontSize: 12, minHeight: 0 }}>
                            Receta
                          </button>
                          <button onClick={() => empezarEdicion(p)} style={{ background: "var(--h421-gray-50)", padding: "6px 10px", fontSize: 12, minHeight: 0 }}>
                            Editar
                          </button>
                          <button onClick={() => eliminarProducto(p)} style={{ background: "var(--h421-red-bg)", color: "var(--h421-red-texto)", padding: "6px 10px", fontSize: 12, minHeight: 0 }}>
                            Eliminar
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div className="card" style={{ maxWidth: 420 }}>
            <h3 style={{ marginTop: 0 }}>Nuevo producto</h3>
            <select value={nuevo.categoriaId} onChange={(e) => setNuevo((n) => ({ ...n, categoriaId: e.target.value }))}
              style={{ width: "100%", padding: 10, marginBottom: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }}>
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
              <button onClick={() => setProductoReceta(null)} style={{ background: "none", color: "var(--h421-gray-400)", minHeight: 0 }}>✕</button>
            </div>
            <p style={{ fontSize: 12, color: "var(--h421-gray-400)", marginTop: -6 }}>
              Las cantidades definidas aquí se descuentan solas del inventario cada vez que se vende este producto.
            </p>

            {receta.length === 0 && <p style={{ color: "var(--h421-gray-400)", fontSize: 13 }}>Sin ingredientes definidos todavía.</p>}
            {receta.map((r) => (
              <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--h421-gray-200)", fontSize: 14 }}>
                <span>{r.insumo.nombre} — {r.cantidad} {r.insumo.unidadMedida}</span>
                <button onClick={() => quitarItemReceta(r.id)} style={{ background: "var(--h421-red-bg)", color: "var(--h421-red-texto)", padding: "4px 8px", fontSize: 12, minHeight: 0 }}>Quitar</button>
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
