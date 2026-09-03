import { useOrderStore } from "../store/orderStore";

export function PanelPedido({ mesaNombre, onCobrar }: { mesaNombre: string | null; onCobrar: () => void }) {
  const { items, cambiarCantidad, quitarItem, numComensales, totales, enviado } = useOrderStore();
  const t = totales();

  return (
    <aside style={{ width: 340, background: "#fff", borderLeft: "1px solid var(--h421-gray-200)", display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--h421-gray-200)" }}>
        <strong style={{ fontSize: 16 }}>{mesaNombre ? `Pedido — ${mesaNombre}` : "Pedido — Mostrador"}</strong>
        {mesaNombre && <div style={{ fontSize: 13, color: "var(--h421-gray-400)" }}>{numComensales} comensal(es)</div>}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "10px 16px" }}>
        {items.length === 0 && <p style={{ color: "var(--h421-gray-400)", fontSize: 14, marginTop: 20 }}>Agrega productos del catálogo…</p>}
        {items.map((item) => (
          <div key={item.id} style={{ display: "flex", gap: 10, padding: "10px 0", borderBottom: "1px solid var(--h421-gray-200)" }}>
            <span style={{
              flexShrink: 0, width: 26, height: 26, borderRadius: 13, background: "var(--h421-blue)", color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, marginTop: 2,
            }}>
              ✓
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 600 }}>{item.cantidad}x {item.nombreProducto}</span>
                <span style={{ fontWeight: 700 }}>${((item.precioUnitario + item.modificadores.reduce((s, m) => s + m.precioExtra, 0)) * item.cantidad).toFixed(2)}</span>
              </div>
              {item.modificadores.length > 0 && (
                <div style={{ fontSize: 12, color: "var(--h421-gray-400)" }}>{item.modificadores.map((m) => m.nombreOpcion).join(", ")}</div>
              )}
              {item.notas && <div style={{ fontSize: 12, color: "var(--h421-gray-400)" }}>Nota: {item.notas}</div>}
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <button onClick={() => cambiarCantidad(item.id, -1)} style={{ width: 28, height: 28, minHeight: 0, background: "var(--h421-gray-50)", borderRadius: 8 }}>−</button>
                <button onClick={() => cambiarCantidad(item.id, 1)} style={{ width: 28, height: 28, minHeight: 0, background: "var(--h421-gray-50)", borderRadius: 8 }}>+</button>
                <button onClick={() => quitarItem(item.id)} style={{ marginLeft: "auto", width: 28, height: 28, minHeight: 0, background: "#fee2e2", color: "var(--h421-red)", borderRadius: 8 }}>🗑</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ padding: "14px 16px", borderTop: "1px solid var(--h421-gray-200)", fontSize: 14 }}>
        <FilaTotal label="Subtotal" valor={t.subtotal} />
        <FilaTotal label="Descuento" valor={-t.descuentoTotal} />
        <FilaTotal label="Impuesto" valor={t.impuesto} />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 20, fontWeight: 800, marginTop: 8, marginBottom: 12, color: "var(--h421-navy)" }}>
          <span>Total</span>
          <span>${t.total.toFixed(2)}</span>
        </div>

        <button
          onClick={onCobrar}
          disabled={!enviado}
          className="btn-grande"
          style={{
            width: "100%", background: "var(--h421-esmeralda)", color: "#fff", fontSize: 17,
            opacity: enviado ? 1 : 0.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
          }}
        >
          <IconoPago />
          Pagar ${t.total.toFixed(2)}
        </button>
      </div>
    </aside>
  );
}

/** Ícono de pago (tarjeta) en SVG en vez de emoji — el emoji 💳 se renderiza distinto según
 *  la fuente del sistema (a veces en color, a veces como glifo monocromo apenas legible en
 *  Windows), un SVG blanco fijo se ve igual siempre y combina con el botón azul marino. */
function IconoPago() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="5" width="20" height="14" rx="2.5" stroke="#fff" strokeWidth="2" />
      <rect x="2" y="9" width="20" height="3.5" fill="#fff" />
      <rect x="5" y="14.5" width="6" height="2" rx="1" fill="#fff" />
    </svg>
  );
}

function FilaTotal({ label, valor }: { label: string; valor: number }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", color: "var(--h421-gray-400)" }}>
      <span>{label}</span>
      <span>${valor.toFixed(2)}</span>
    </div>
  );
}
