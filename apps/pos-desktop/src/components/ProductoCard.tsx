import type { Producto } from "@hangar421/shared";

export function ProductoCard({ producto, onSeleccionar }: { producto: Producto; onSeleccionar: (p: Producto) => void }) {
  const disponible = producto.disponibleSucursal !== false;
  return (
    <button
      onClick={() => disponible && onSeleccionar(producto)}
      disabled={!disponible}
      className="btn-grande"
      style={{
        display: "flex", flexDirection: "column", alignItems: "stretch",
        background: "#fff", padding: 0, overflow: "hidden",
        border: "1px solid var(--h421-gray-200)", opacity: disponible ? 1 : 0.5,
        textAlign: "left", minHeight: 150,
      }}
    >
      <div style={{
        height: 90, background: producto.imagenUrl ? `url(${producto.imagenUrl}) center/cover` : "var(--h421-gray-50)",
        display: "flex", alignItems: "center", justifyContent: "center", color: "var(--h421-gray-400)", fontSize: 28,
      }}>
        {!producto.imagenUrl && "☕"}
      </div>
      <div style={{ padding: "10px 12px" }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: "var(--h421-black)" }}>{producto.nombre}</div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
          <span style={{ fontWeight: 700, color: "var(--h421-navy)" }}>${(producto.precioSucursal ?? producto.precioBase).toFixed(2)}</span>
          <span style={{ fontSize: 12, color: disponible ? "var(--h421-green)" : "var(--h421-red)" }}>
            {disponible ? "● disponible" : "○ agotado"}
          </span>
        </div>
      </div>
    </button>
  );
}
