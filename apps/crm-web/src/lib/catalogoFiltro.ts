import type { Producto } from "@hangar421/shared";

/** Quita acentos y mayúsculas para que "cafe" encuentre "Café Americano" y "capuchino" a
 *  "Capuchino". Mismo criterio para el texto buscado y para el nombre del producto. */
export function normalizarBusqueda(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Filtra el catálogo por categoría ("" = todas) y por texto libre sobre nombre, descripción y
 *  subcategoría. Cada palabra escrita debe aparecer ("cafe frio" encuentra "Café Frío Vainilla").
 *  Vive fuera de la página para poder razonarlo sin React. */
export function filtrarProductos(productos: Producto[], categoriaId: string, busqueda: string): Producto[] {
  const q = normalizarBusqueda(busqueda);
  return productos.filter((p) => {
    if (categoriaId && p.categoriaId !== categoriaId) return false;
    if (!q) return true;
    const texto = normalizarBusqueda([p.nombre, p.descripcion ?? "", p.subcategoria ?? ""].join(" "));
    return q.split(/\s+/).every((palabra) => texto.includes(palabra));
  });
}
