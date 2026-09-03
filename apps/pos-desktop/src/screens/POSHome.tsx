import { useRef, useState } from "react";
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
  const { agregarItem } = useOrderStore();
  const sucursalId = useAuthStore((s) => s.sucursalId)!;
  const [categoriaActiva, setCategoriaActiva] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [sugerenciasAbiertas, setSugerenciasAbiertas] = useState(false);
  const inputBusquedaRef = useRef<HTMLInputElement>(null);
  const [productoModal, setProductoModal] = useState<Producto | null>(null);
  const [mostrarCobro, setMostrarCobro] = useState(false);
  const [mostrarDescuento, setMostrarDescuento] = useState(false);

  // Respaldo defensivo en el front: si por lo que sea el catálogo trae una categoría repetida
  // (incluso con el catálogo del backend ya corregido para no duplicar), se muestra una sola
  // vez — se conserva la primera aparición, ya ordenada por `orden` desde la API.
  const categoriasUnicas = Array.from(new Map(categorias.map((c) => [c.nombre, c])).values());

  const productosFiltrados = productos.filter((p) => {
    const porCategoria = !categoriaActiva || p.categoriaId === categoriaActiva;
    const porBusqueda = !busqueda || p.nombre.toLowerCase().includes(busqueda.toLowerCase());
    return porCategoria && porBusqueda;
  });

  // Sugerencias de autocompletado — se recalculan en cada letra tecleada, sin importar la
  // categoría activa (buscan en todo el catálogo), para que el mesero encuentre un producto
  // aunque esté parado en otra categoría. Tope de 8 para que la lista no tape la pantalla.
  const sugerencias = busqueda
    ? productos.filter((p) => p.nombre.toLowerCase().includes(busqueda.toLowerCase())).slice(0, 8)
    : [];

  function elegirSugerencia(producto: Producto) {
    seleccionarProducto(producto);
    setBusqueda("");
    setSugerenciasAbiertas(false);
  }

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
                  // Color sólido siempre — antes las píldoras inactivas bajaban a 75% de opacidad
                  // y se veían lavadas; ahora todas se ven igual de fuertes, y solo el contorno
                  // navy + sombra marcan cuál está seleccionada.
                  background: color,
                  color: colorTextoContraste(color),
                  outline: activa ? "2px solid var(--h421-navy)" : "none",
                  outlineOffset: 2,
                  boxShadow: activa ? `0 4px 10px ${color}66` : "none",
                }}>
                {c.nombre}
              </button>
            );
          })}
        </div>

        {/* Buscador — siempre visible debajo de las categorías, con autocompletado: la lista
            de sugerencias se recalcula en cada letra tecleada y busca en TODO el catálogo
            (no solo la categoría activa). Elegir una sugerencia agrega el producto directo,
            igual que tocar su tarjeta en la cuadrícula. */}
        <div style={{ position: "relative", padding: "0 16px 14px", background: "#fff", borderBottom: "1px solid var(--h421-gray-200)" }}>
          <input
            ref={inputBusquedaRef}
            placeholder="🔍 Buscar producto…"
            value={busqueda}
            onChange={(e) => { setBusqueda(e.target.value); setSugerenciasAbiertas(true); }}
            onFocus={() => setSugerenciasAbiertas(true)}
            onBlur={() => setTimeout(() => setSugerenciasAbiertas(false), 150)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && sugerencias[0]) elegirSugerencia(sugerencias[0]);
              if (e.key === "Escape") { setBusqueda(""); setSugerenciasAbiertas(false); }
            }}
            style={{ width: "100%", padding: "0 14px", height: 44, borderRadius: 12, border: "1px solid var(--h421-gray-200)", fontSize: 15 }}
          />
          {sugerenciasAbiertas && sugerencias.length > 0 && (
            <div style={{
              position: "absolute", left: 16, right: 16, top: "100%", zIndex: 10,
              background: "#fff", borderRadius: 12, boxShadow: "0 8px 24px rgba(11,30,51,0.18)",
              border: "1px solid var(--h421-gray-200)", overflow: "hidden",
            }}>
              {sugerencias.map((p) => (
                <button
                  key={p.id}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => elegirSugerencia(p)}
                  style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%",
                    padding: "10px 14px", background: "none", border: "none", borderBottom: "1px solid var(--h421-gray-50)",
                    textAlign: "left", cursor: "pointer", fontSize: 14,
                  }}
                >
                  <span style={{ color: "var(--h421-black)", fontWeight: 600 }}>{p.nombre}</span>
                  <span style={{ color: "var(--h421-navy)", fontWeight: 700 }}>${(p.precioSucursal ?? p.precioBase).toFixed(2)}</span>
                </button>
              ))}
            </div>
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
                  // "auto-fill" con un máximo (210px): las tarjetas mantienen siempre el mismo
                  // tamaño que en una categoría con muchos productos (ej. Bebidas frías) — antes,
                  // con "auto-fit" y sin tope, una subcategoría con pocos productos (ej. 2) las
                  // estiraba mucho más grandes para llenar la fila, y no coincidían con el resto.
                  gridTemplateColumns: "repeat(auto-fill, minmax(170px, 210px))",
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

        {/* Barra inferior — acciones rápidas como íconos circulares. Este negocio no tiene
            cocina/estación de preparación separada: el cliente pide y paga en el momento, así
            que no hay un paso de "enviar a cocina" — "Pagar" en el panel de la derecha crea el
            pedido y lo cobra en una sola acción. */}
        <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "12px 20px", background: "#fff", borderTop: "1px solid var(--h421-gray-200)" }}>
          <AccionCircular icono="🔍" etiqueta="Buscar" color="var(--h421-blue)" onClick={() => inputBusquedaRef.current?.focus()} />
          <AccionCircular icono="🍽" etiqueta="Mesas" color="var(--h421-blue)" />
          <AccionCircular icono="👤" etiqueta="Clientes" color="var(--h421-blue)" />
          <AccionCircular icono="⏸" etiqueta="Suspender" color="var(--h421-gray-400)" />
          <AccionCircular icono="%" etiqueta="Descuento" color="var(--h421-yellow)" onClick={() => setMostrarDescuento(true)} />
          <AccionCircular icono="🗑" etiqueta="Eliminar" color="var(--h421-red)" onClick={() => useOrderStore.getState().limpiar()} />
        </div>
      </div>

      <PanelPedido mesaNombre={mesaNombre} onCobrar={() => setMostrarCobro(true)} />

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
