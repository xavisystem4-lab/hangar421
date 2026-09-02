import { useState } from "react";
import type { Producto } from "@hangar421/shared";
import { useCatalogoStore } from "../store/catalogStore";
import { useOrderStore } from "../store/orderStore";
import { ProductoCard } from "../components/ProductoCard";
import { PanelPedido } from "../components/PanelPedido";
import { ModalModificadores } from "../components/ModalModificadores";
import { ModalCobro } from "../components/ModalCobro";
import { ModalDescuento } from "../components/ModalDescuento";
import { useAuthStore } from "../store/authStore";

export function POSHome({ mesaNombre, onVentaCobrada }: { mesaNombre: string | null; onVentaCobrada: () => void }) {
  const { categorias, productos } = useCatalogoStore();
  const { agregarItem, items, enviarACocina, enviado } = useOrderStore();
  const sucursalId = useAuthStore((s) => s.sucursalId)!;
  const [categoriaActiva, setCategoriaActiva] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [productoModal, setProductoModal] = useState<Producto | null>(null);
  const [mostrarCobro, setMostrarCobro] = useState(false);
  const [mostrarDescuento, setMostrarDescuento] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const productosFiltrados = productos.filter((p) => {
    const porCategoria = !categoriaActiva || p.categoriaId === categoriaActiva;
    const porBusqueda = !busqueda || p.nombre.toLowerCase().includes(busqueda.toLowerCase());
    return porCategoria && porBusqueda;
  });

  function seleccionarProducto(producto: Producto) {
    if ((producto.modificadores?.length ?? 0) > 0) {
      setProductoModal(producto);
    } else {
      agregarItem({
        productoId: producto.id,
        nombreProducto: producto.nombre,
        cantidad: 1,
        precioUnitario: producto.precioSucursal ?? producto.precioBase,
        modificadores: [],
      });
    }
  }

  async function manejarEnviarCocina() {
    setAviso(null);
    setEnviando(true);
    try {
      await enviarACocina();
      setAviso("Pedido enviado a cocina ✔");
    } catch (e: any) {
      setAviso(e.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div style={{ display: "flex", height: "100%" }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Categorías */}
        <div style={{ display: "flex", gap: 8, padding: "12px 16px", overflowX: "auto", background: "#fff", borderBottom: "1px solid var(--h421-gray-200)" }}>
          <button onClick={() => setCategoriaActiva(null)} className="btn-grande"
            style={{ background: !categoriaActiva ? "var(--h421-navy)" : "var(--h421-gray-50)", color: !categoriaActiva ? "#fff" : "#000", padding: "0 18px" }}>
            Todas
          </button>
          {categorias.map((c) => (
            <button key={c.id} onClick={() => setCategoriaActiva(c.id)} className="btn-grande"
              style={{ background: categoriaActiva === c.id ? "var(--h421-navy)" : "var(--h421-gray-50)", color: categoriaActiva === c.id ? "#fff" : "#000", padding: "0 18px", whiteSpace: "nowrap" }}>
              {c.nombre}
            </button>
          ))}
          <input placeholder="🔍 Buscar producto…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
            style={{ marginLeft: "auto", padding: "0 14px", minWidth: 220, borderRadius: 12, border: "1px solid var(--h421-gray-200)" }} />
        </div>

        {/* Cuadrícula de productos */}
        <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 14 }}>
          {productosFiltrados.map((p) => (
            <ProductoCard key={p.id} producto={p} onSeleccionar={seleccionarProducto} />
          ))}
        </div>

        {/* Barra inferior */}
        <div style={{ display: "flex", gap: 10, padding: 14, background: "#fff", borderTop: "1px solid var(--h421-gray-200)" }}>
          <button className="btn-grande" style={{ background: "var(--h421-gray-50)", padding: "0 18px" }}>🔍 Buscar</button>
          <button className="btn-grande" style={{ background: "var(--h421-gray-50)", padding: "0 18px" }}>👤 Clientes</button>
          <button className="btn-grande" style={{ background: "var(--h421-gray-50)", padding: "0 18px" }}>⏸ Suspender</button>
          <button className="btn-grande" style={{ background: "#fef3c7", color: "#92400e", padding: "0 18px" }} onClick={() => setMostrarDescuento(true)}>% Descuento</button>
          <button className="btn-grande" style={{ background: "#fee2e2", color: "var(--h421-red)", padding: "0 18px" }} onClick={() => useOrderStore.getState().limpiar()}>✕ Cancelar</button>
          <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
            <button
              className="btn-grande"
              disabled={items.length === 0 || enviando}
              onClick={manejarEnviarCocina}
              style={{ background: "var(--h421-blue)", color: "#fff", padding: "0 26px", fontSize: 16 }}
            >
              📨 {enviando ? "Enviando…" : "Enviar a cocina"}
            </button>
            <button
              className="btn-grande"
              disabled={!enviado}
              onClick={() => setMostrarCobro(true)}
              style={{ background: "var(--h421-green)", color: "#fff", padding: "0 26px", fontSize: 16 }}
            >
              💳 Cobrar
            </button>
          </div>
        </div>
        {aviso && <div style={{ padding: "6px 16px", fontSize: 13, color: "var(--h421-navy)" }}>{aviso}</div>}
      </div>

      <PanelPedido mesaNombre={mesaNombre} />

      {productoModal && (
        <ModalModificadores
          producto={productoModal}
          onCancelar={() => setProductoModal(null)}
          onConfirmar={(cantidad, seleccion, notas) => {
            agregarItem({
              productoId: productoModal.id,
              nombreProducto: productoModal.nombre,
              cantidad,
              precioUnitario: productoModal.precioSucursal ?? productoModal.precioBase,
              modificadores: seleccion,
              notas: notas || undefined,
            });
            setProductoModal(null);
          }}
        />
      )}

      {mostrarCobro && (
        <ModalCobro onCerrar={() => setMostrarCobro(false)} onCobrado={() => { setMostrarCobro(false); onVentaCobrada(); }} />
      )}

      {mostrarDescuento && (
        <ModalDescuento sucursalId={sucursalId} onCerrar={() => setMostrarDescuento(false)} />
      )}
    </div>
  );
}
