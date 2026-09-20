/** Armado del reporte — lógica pura, sin imports nativos, para poder probarla bajo Jest (ver
 *  el mismo criterio en db/busqueda.ts y caja/denominaciones.ts).
 *
 *  Aquí vive TODO lo que decide qué dice el reporte: las filas, los rótulos y el HTML. El módulo
 *  de al lado (exportar.ts) solo escribe ficheros y abre el diálogo de compartir. */

export interface DatosReporte {
  sucursal: string;
  desde: string;
  hasta: string;
  cajero: string | null;
  busqueda: string | null;
  totalVentas: number;
  cantidadVentas: number;
  ticketPromedio: number;
  porMetodo: { metodo: string; total: number; cantidad: number }[];
  topProductos: { nombre: string; cantidad: number; total: number }[];
  ventas: { folioLocal: number; createdAt: string; total: number; cajero: string; metodos: string; productos: string }[];
}

export function formatearFecha(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

export function formatearFechaHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${formatearFecha(iso)} ${hh}:${min}`;
}

export function formatearDinero(n: number): string {
  return `$${(Number(n) || 0).toFixed(2)}`;
}

/** Nombre de archivo sin caracteres que Android o Windows rechacen, y con las fechas dentro
 *  para que dos reportes distintos no se pisen en la carpeta de descargas. */
export function nombreArchivo(datos: DatosReporte, extension: string): string {
  const limpio = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `Reporte-${limpio(datos.sucursal || "HANGAR421")}-${limpio(datos.desde)}_a_${limpio(datos.hasta)}.${extension}`;
}

/** Filas del Excel: una por venta, más una cabecera. Se devuelve como matriz para que el
 *  generador de xlsx y el de CSV consuman exactamente lo mismo y no se desincronicen. */
export function filasDetalle(datos: DatosReporte): (string | number)[][] {
  const cabecera = ["Folio", "Fecha", "Cajero", "Métodos de pago", "Productos", "Total"];
  const filas = datos.ventas.map((v) => [
    v.folioLocal,
    formatearFechaHora(v.createdAt),
    v.cajero,
    v.metodos,
    v.productos,
    Number(v.total) || 0,
  ]);
  return [cabecera, ...filas];
}

export function filasResumen(datos: DatosReporte): (string | number)[][] {
  const filas: (string | number)[][] = [
    ["Reporte de ventas"],
    ["Sucursal", datos.sucursal],
    ["Desde", formatearFecha(datos.desde)],
    ["Hasta", formatearFecha(datos.hasta)],
    ["Cajero", datos.cajero ?? "Todos"],
  ];
  if (datos.busqueda) filas.push(["Filtro de producto", datos.busqueda]);
  filas.push(
    [],
    ["Total vendido", datos.totalVentas],
    ["Número de ventas", datos.cantidadVentas],
    ["Ticket promedio", datos.ticketPromedio],
    [],
    ["Método de pago", "Operaciones", "Total"],
    ...datos.porMetodo.map((m) => [m.metodo, m.cantidad, m.total]),
    [],
    ["Producto", "Unidades", "Importe"],
    ...datos.topProductos.map((p) => [p.nombre, p.cantidad, p.total]),
  );
  return filas;
}

/** Escapa lo que va dentro del HTML del PDF. El nombre de un producto puede llevar `&` ("H & T"
 *  está en el menú) y sin escaparlo rompe el marcado. */
export function escaparHtml(texto: string): string {
  return String(texto)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** HTML del PDF. Se construye a mano y no con una librería de PDF: expo-print ya convierte HTML
 *  a PDF con el motor del sistema, y así el reporte se puede previsualizar y ajustar sin tocar
 *  código de bajo nivel. */
export function htmlReporte(datos: DatosReporte): string {
  const filaMetodo = datos.porMetodo
    .map((m) => `<tr><td>${escaparHtml(m.metodo)}</td><td class="num">${m.cantidad}</td><td class="num">${formatearDinero(m.total)}</td></tr>`)
    .join("");
  const filaProducto = datos.topProductos
    .map((p) => `<tr><td>${escaparHtml(p.nombre)}</td><td class="num">${p.cantidad}</td><td class="num">${formatearDinero(p.total)}</td></tr>`)
    .join("");
  const filaVenta = datos.ventas
    .map(
      (v) =>
        `<tr><td>#${v.folioLocal}</td><td>${escaparHtml(formatearFechaHora(v.createdAt))}</td><td>${escaparHtml(v.cajero)}</td>` +
        `<td>${escaparHtml(v.metodos)}</td><td class="prod">${escaparHtml(v.productos)}</td><td class="num">${formatearDinero(v.total)}</td></tr>`,
    )
    .join("");

  const filtros = [
    `Del ${formatearFecha(datos.desde)} al ${formatearFecha(datos.hasta)}`,
    `Cajero: ${escaparHtml(datos.cajero ?? "Todos")}`,
    datos.busqueda ? `Producto: ${escaparHtml(datos.busqueda)}` : null,
  ].filter(Boolean).join(" · ");

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8" />
<style>
  body { font-family: -apple-system, Roboto, Helvetica, Arial, sans-serif; color: #0B1E33; padding: 24px; font-size: 12px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #666; font-size: 12px; margin-bottom: 18px; }
  .tarjetas { display: flex; gap: 12px; margin-bottom: 20px; }
  .tarjeta { flex: 1; border: 1px solid #E5E7EB; border-radius: 8px; padding: 10px; }
  .tarjeta .v { font-size: 18px; font-weight: 700; }
  .tarjeta .e { color: #666; font-size: 11px; }
  h2 { font-size: 14px; margin: 18px 0 6px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border-bottom: 1px solid #E5E7EB; padding: 6px 4px; text-align: left; vertical-align: top; }
  th { background: #F3F4F6; font-size: 11px; text-transform: uppercase; }
  .num { text-align: right; white-space: nowrap; }
  .prod { color: #444; font-size: 11px; }
  footer { margin-top: 22px; color: #999; font-size: 10px; }
</style></head>
<body>
  <h1>Reporte de ventas — ${escaparHtml(datos.sucursal)}</h1>
  <div class="sub">${filtros}</div>

  <div class="tarjetas">
    <div class="tarjeta"><div class="v">${formatearDinero(datos.totalVentas)}</div><div class="e">Total vendido</div></div>
    <div class="tarjeta"><div class="v">${datos.cantidadVentas}</div><div class="e">Ventas</div></div>
    <div class="tarjeta"><div class="v">${formatearDinero(datos.ticketPromedio)}</div><div class="e">Ticket promedio</div></div>
  </div>

  <h2>Por método de pago</h2>
  <table><thead><tr><th>Método</th><th class="num">Operaciones</th><th class="num">Total</th></tr></thead>
  <tbody>${filaMetodo || `<tr><td colspan="3">Sin pagos en el rango.</td></tr>`}</tbody></table>

  <h2>Productos más vendidos</h2>
  <table><thead><tr><th>Producto</th><th class="num">Unidades</th><th class="num">Importe</th></tr></thead>
  <tbody>${filaProducto || `<tr><td colspan="3">Sin ventas en el rango.</td></tr>`}</tbody></table>

  <h2>Detalle de ventas (${datos.ventas.length})</h2>
  <table><thead><tr><th>Folio</th><th>Fecha</th><th>Cajero</th><th>Pago</th><th>Productos</th><th class="num">Total</th></tr></thead>
  <tbody>${filaVenta || `<tr><td colspan="6">Sin ventas en el rango.</td></tr>`}</tbody></table>

  <footer>Generado por HANGAR 421 Punto de Venta el ${formatearFechaHora(new Date().toISOString())} — datos locales de esta terminal.</footer>
</body></html>`;
}
