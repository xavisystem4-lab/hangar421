"use client";

export interface VarianteVendida {
  descripcion: string;
  cantidad: number;
}

export interface ProductoVendidoDetalle {
  nombre: string;
  categoria?: string | null;
  subcategoria?: string | null;
  variantes?: VarianteVendida[];
}

/** Etiqueta corta para gráficas: el nombre y, entre paréntesis, la categoría cuando hay otro
 *  producto con el mismo nombre en la lista (dos "Latte" se distinguen por su categoría). */
export function etiquetaProducto(p: ProductoVendidoDetalle, todos: ProductoVendidoDetalle[]): string {
  const repetido = todos.filter((o) => o.nombre === p.nombre).length > 1;
  return repetido && p.categoria ? `${p.nombre} (${p.categoria})` : p.nombre;
}

/** Nombre del producto con su categoría/subcategoría en gris y, debajo, el desglose por
 *  modificadores con los que se vendió ("Grande · Leche de avena ×2 · Chico ×1"). */
export function ProductoVendido({ producto, mostrarCategoria = true }: { producto: ProductoVendidoDetalle; mostrarCategoria?: boolean }) {
  const variantes = producto.variantes ?? [];
  const ruta = [producto.categoria, producto.subcategoria].filter(Boolean).join(" › ");
  return (
    <span style={{ display: "inline-block", verticalAlign: "top" }}>
      <span style={{ fontWeight: 600 }}>{producto.nombre}</span>
      {mostrarCategoria && ruta && <span style={{ color: "var(--h421-gray-400)", fontSize: 12, marginLeft: 6 }}>· {ruta}</span>}
      {variantes.length > 0 && (
        <span style={{ display: "block", fontSize: 12, color: "var(--h421-gray-400)", marginTop: 2 }}>
          {variantes.map((v, i) => (
            <span key={v.descripcion}>
              {i > 0 && " · "}
              {v.descripcion === "Sin modificadores" ? <em>sin modificadores</em> : v.descripcion} <strong style={{ color: "inherit" }}>×{v.cantidad}</strong>
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
