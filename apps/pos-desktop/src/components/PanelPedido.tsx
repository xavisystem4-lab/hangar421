import { useOrderStore } from "../store/orderStore";

export function PanelPedido({ mesaNombre }: { mesaNombre: string | null }) {
  const { items, cambiarCantidad, quitarItem, numComensales, totales } = useOrderStore();
  const t = totales();

  return (
    <aside style={{ width: 340, background: "#fff", borderLeft: "1px solid var(--h421-gray-200)", display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--h421-gray-200)" }}>
        <strong style={{ fontSize: 16 }}>{mesaNombre ? `Pedido — ${mesaNombre}` : "Pedido — Mostrador"}</strong>
        {mesaNombre && <div style={{ fontSize: 13, color: "var(--h421-gray-400)" }}>{numComensales} comensal(es)</div>}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "8px 16px" }}>
        {items.length === 0 && <p style={{ color: "var(--h421-gray-400)", fontSize: 14, marginTop: 20 }}>Agrega productos del catálogo…</p>}
        {items.map((item) => (
          <div key={item.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--h421-gray-200)" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontWeight: 600 }}>{item.cantidad}x {item.nombreProducto}</span>
              <span>${((item.precioUnitario + item.modificadores.reduce((s, m) => s + m.precioExtra, 0)) * item.cantidad).toFixed(2)}</span>
            </div>
            {item.modificadores.length > 0 && (
              <div style={{ fontSize: 12, color: "var(--h421-gray-400)" }}>{item.modificadores.map((m) => m.nombreOpcion).join(", ")}</div>
            )}
            {item.notas && <div style={{ fontSize: 12, color: "var(--h421-gray-400)" }}>Nota: {item.notas}</div>}
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <button onClick={() => cambiarCantidad(item.id, -1)} style={{ width: 32, height: 32, minHeight: 0, background: "var(--h421-gray-50)" }}>−</button>
              <button onClick={() => cambiarCantidad(item.id, 1)} style={{ width: 32, height: 32, minHeight: 0, background: "var(--h421-gray-50)" }}>+</button>
              <button onClick={() => quitarItem(item.id)} style={{ marginLeft: "auto", width: 32, height: 32, minHeight: 0, background: "#fee2e2", color: "var(--h421-red)" }}>🗑</button>
            </div>
          </div>
        ))}
      </div>

      <div style={{ padding: "14px 16px", borderTop: "1px solid var(--h421-gray-200)", fontSize: 14 }}>
        <FilaTotal label="Subtotal" valor={t.subtotal} />
        <FilaTotal label="Descuento" valor={-t.descuentoTotal} />
        <FilaTotal label="Impuesto" valor={t.impuesto} />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 20, fontWeight: 800, marginTop: 8, color: "var(--h421-navy)" }}>
          <span>Total</span>
          <span>${t.total.toFixed(2)}</span>
        </div>
      </div>
    </aside>
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
