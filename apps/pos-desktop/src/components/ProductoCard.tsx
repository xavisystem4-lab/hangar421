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
        background: "var(--h421-white)", padding: 0, overflow: "hidden",
        border: "none", borderRadius: 16, opacity: disponible ? 1 : 0.5,
        textAlign: "left", minHeight: 170,
        boxShadow: "0 2px 8px rgba(11,30,51,0.08)",
      }}
    >
      <div style={{
        height: 110, background: producto.imagenUrl ? `url(${producto.imagenUrl}) center/cover` : "linear-gradient(135deg, var(--h421-gray-50), var(--h421-gray-200))",
        display: "flex", alignItems: "center", justifyContent: "center", color: "var(--h421-gray-400)", fontSize: 34,
        position: "relative",
      }}>
        {!producto.imagenUrl && "☕"}
        {!disponible && (
          <span style={{ position: "absolute", top: 8, right: 8, background: "var(--h421-red)", color: "#fff", fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 8 }}>
            AGOTADO
          </span>
        )}
      </div>
      <div style={{ padding: "10px 12px 12px" }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: "var(--h421-black)", lineHeight: 1.25, minHeight: 34 }}>{producto.nombre}</div>
        <div style={{ fontWeight: 800, fontSize: 17, color: "var(--h421-navy-texto)", marginTop: 6 }}>
          ${(producto.precioSucursal ?? producto.precioBase).toFixed(2)}
        </div>
      </div>
    </button>
  );
}
