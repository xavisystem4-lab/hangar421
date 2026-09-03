import { useState } from "react";
import type { Producto } from "@hangar421/shared";
import { useCatalogoStore } from "../store/catalogStore";
import { useOrderStore } from "../store/orderStore";
import { ProductoCard } from "../components/ProductoCard";
import { PanelPedido } from "../components/PanelPedido";
import { ModalModificadores } from "../components/ModalModificadores";
import { ModalCobro } from "../components/ModalCobro";
import { ModalDescuento } from "../components/ModalDescuento";
import { AccionCircular } from "../components/AccionCircular";
import { useAuthStore } from "../store/authStore";
import { CATEGORIA_COLORES, colorTextoContraste } from "../theme/categoriaColores";

export function POSHome({ mesaNombre, onVentaCobrada }: { mesaNombre: string | null; onVentaCobrada: () => void }) {
  const { categorias, productos } = useCatalogoStore();
  const { agregarItem, items, enviarACocina, enviado } = useOrderStore();
  const sucursalId = useAuthStore((s) => s.sucursalId)!;
  const [categoriaActiva, setCategoriaActiva] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [mostrarBusqueda, setMostrarBusqueda] = useState(false);
  const [productoModal, setProductoModal] = useState<Producto | null>(null);
  const [mostrarCobro, setMostrarCobro] = useState(false);
  const [mostrarDescuento, setMostrarDescuento] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  // Respaldo defensivo en el front: si por lo que sea el catálogo trae una categoría repetida
  // (incluso con el catálogo del backend ya corregido para no duplicar), se muestra una sola
  // vez — se conserva la primera aparición, ya ordenada por `orden` desde la API.
  const categoriasUnicas = Array.from(new Map(categorias.map((c) => [c.nombre, c])).values());

  const productosFiltrados = productos.filter((p) => {
    const porCategoria = !categoriaActiva || p.categoriaId === categoriaActiva;
    const porBusqueda = !busqueda || p.nombre.toLowerCase().includes(busqueda.toLowerCase());
    return porCategoria && porBusqueda;
  });

  // Agrupa por subcategoría (ej. dentro de "Postres": Galletas by Domingo / Roles de Canela by
  // Törtchen / Chunky Cookies) preservando el orden en que llegaron (ya vienen ordenados por
  // `orden` desde el backend). Si nadie tiene subcategoría, queda un solo grupo sin encabezado.
  const gruposProductos: { titulo: string | null; productos: typeof productosFiltrados }[] = [];
  for (const p of productosFiltrados) {
    const titulo = p.subcategoria ?? null;
    const grupo = gruposProductos.find((g) => g.titulo === titulo);
    if (grupo) grupo.productos.push(p);
    else gruposProductos.push({ titulo, productos: [p] });
  }

  function seleccionarProducto(producto: Producto) {
    if (producto.requierePersonalizacion) {
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

  /** Al tocar "Pagar" ya no hace falta haber presionado "Enviar a cocina" primero — si el
   *  pedido aún no se mandó, se envía en el momento (silencioso) y de una vez se abre el cobro,
   *  para no bloquear la venta con un paso manual extra. */
  async function manejarCobrar() {
    if (!enviado) {
      setAviso(null);
      try {
        await enviarACocina();
      } catch (e: any) {
        setAviso(e.message);
        return;
      }
    }
    setMostrarCobro(true);
  }

  return (
    <div style={{ display: "flex", height: "100%" }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Categorías — píldoras de color, una por categoría */}
        <div style={{ display: "flex", gap: 10, padding: "14px 16px", overflowX: "auto", background: "#fff", borderBottom: "1px solid var(--h421-gray-200)", alignItems: "center" }}>
          <button onClick={() => setCategoriaActiva(null)} className="pildora-categoria"
            style={{ background: !categoriaActiva ? "var(--h421-navy)" : "var(--h421-gray-50)", color: !categoriaActiva ? "#fff" : "var(--h421-black)" }}>
            Todas
          </button>
          {categoriasUnicas.map((c, i) => {
            const color = CATEGORIA_COLORES[i % CATEGORIA_COLORES.length];
            const activa = categoriaActiva === c.id;
            return (
              <button key={c.id} onClick={() => setCategoriaActiva(c.id)} className="pildora-categoria"
                style={{
                  background: color,
                  color: colorTextoContraste(color),
                  opacity: activa ? 1 : 0.75,
                  outline: activa ? "2px solid var(--h421-navy)" : "none",
                  outlineOffset: 2,
                  boxShadow: activa ? `0 4px 10px ${color}66` : "none",
                }}>
                {c.nombre}
              </button>
            );
          })}
          {mostrarBusqueda && (
            <input autoFocus placeholder="Buscar producto…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
              style={{ marginLeft: "auto", padding: "0 14px", minWidth: 220, height: 44, borderRadius: 12, border: "1px solid var(--h421-gray-200)" }} />
          )}
        </div>

        {/* Cuadrícula de productos, agrupada por subcategoría cuando aplica. alignContent/
            alignItems "start" evita que las tarjetas se estiren para llenar el alto disponible
            cuando hay pocos productos (el default de grid es "stretch", que infla las filas
            hasta ocupar todo el contenedor). */}
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {gruposProductos.map((grupo, i) => (
            <div key={grupo.titulo ?? `_${i}`} style={{ marginTop: i > 0 ? 20 : 0 }}>
              {grupo.titulo && (
                <h3 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 700, color: "var(--h421-navy)", textTransform: "uppercase", letterSpacing: 0.4 }}>
                  {grupo.titulo}
                </h3>
              )}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
                  gridAutoRows: "min-content",
                  alignContent: "start",
                  alignItems: "start",
                  gap: 16,
                }}
              >
                {grupo.productos.map((p) => (
                  <ProductoCard key={p.id} producto={p} onSeleccionar={seleccionarProducto} />
                ))}
              </div>
            </div>
          ))}
        </div>

        {aviso && <div style={{ padding: "4px 16px", fontSize: 13, color: "var(--h421-navy)" }}>{aviso}</div>}

        {/* Barra inferior — acciones rápidas como íconos circulares + envío a cocina */}
        <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "12px 20px", background: "#fff", borderTop: "1px solid var(--h421-gray-200)" }}>
          <AccionCircular icono="🔍" etiqueta="Buscar" color="var(--h421-blue)" onClick={() => setMostrarBusqueda((v) => !v)} />
          <AccionCircular icono="🍽" etiqueta="Mesas" color="var(--h421-blue)" />
          <AccionCircular icono="👤" etiqueta="Clientes" color="var(--h421-blue)" />
          <AccionCircular icono="⏸" etiqueta="Suspender" color="var(--h421-gray-400)" />
          <AccionCircular icono="%" etiqueta="Descuento" color="var(--h421-yellow)" onClick={() => setMostrarDescuento(true)} />
          <AccionCircular icono="🗑" etiqueta="Eliminar" color="var(--h421-red)" onClick={() => useOrderStore.getState().limpiar()} />

          <button
            className="btn-grande"
            disabled={items.length === 0 || enviando}
            onClick={manejarEnviarCocina}
            style={{ marginLeft: "auto", background: "var(--h421-navy)", color: "#fff", padding: "0 28px", fontSize: 16 }}
          >
            📨 {enviando ? "Enviando…" : "Enviar a cocina"}
          </button>
        </div>
      </div>

      <PanelPedido mesaNombre={mesaNombre} onCobrar={manejarCobrar} />

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
        <ModalCobro mesaNombre={mesaNombre} onCerrar={() => setMostrarCobro(false)} onCobrado={() => { setMostrarCobro(false); onVentaCobrada(); }} />
      )}

      {mostrarDescuento && (
        <ModalDescuento sucursalId={sucursalId} onCerrar={() => setMostrarDescuento(false)} />
      )}
    </div>
  );
}
