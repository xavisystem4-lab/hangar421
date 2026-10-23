import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { guardarConDialogoWeb } from "@/components/ReporteInventario";

/**
 * Exportación a PDF y Excel de los reportes de ventas del ERP: Reportes → Ventas (por producto y
 * por método de pago) y el módulo Ventas (los tickets del rango con sus filtros). Mismo encabezado
 * y colores que los reportes de inventario y crédito de empleados.
 */

const TIPO_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const NAVY: [number, number, number] = [11, 30, 51];
const NARANJA: [number, number, number] = [255, 106, 19];
const ZONA = "America/Mexico_City";

const dinero = (n: number) => `$${(Number.isFinite(n) ? n : 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const redondo = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** "12/10/2026" o "06/10/2026 al 12/10/2026". */
export function periodoTexto(desde: string, hasta: string): string {
  const f = (d: string) => d.split("-").reverse().join("/");
  return desde === hasta ? f(desde) : `${f(desde)} al ${f(hasta)}`;
}

const fechaHora = (iso: string, zona = ZONA) =>
  new Date(iso).toLocaleString("es-MX", { timeZone: zona, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

function encabezado(doc: jsPDF, titulo: string, subtitulo: string): number {
  const ancho = doc.internal.pageSize.getWidth();
  doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.setTextColor(...NAVY);
  doc.text(`HANGAR 421 · ${titulo}`, 40, 50);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(107, 114, 128);
  doc.text(subtitulo, 40, 68);
  doc.setFontSize(8);
  doc.text(`Generado el ${new Date().toLocaleString("es-MX", { dateStyle: "long", timeStyle: "short" })}`, ancho - 40, 50, { align: "right" });
  doc.setDrawColor(...NARANJA); doc.setLineWidth(2); doc.line(40, 78, ancho - 40, 78);
  return 92;
}

/** Alinea a la derecha encabezado y pie de las columnas numéricas (columnStyles solo toca el cuerpo). */
const derecha = (...columnas: number[]) => (c: { section: string; column: { index: number }; cell: { styles: { halign?: string } } }) => {
  if (c.section !== "body" && columnas.includes(c.column.index)) c.cell.styles.halign = "right";
};

const finalY = (doc: jsPDF, por: number) => ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? por);

function titulo(doc: jsPDF, texto: string, y: number): number {
  if (y > doc.internal.pageSize.getHeight() - 80) { doc.addPage(); y = 50; }
  doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(...NAVY);
  doc.text(texto, 40, y);
  return y + 8;
}

/** Fila de "tarjetas" con los totales arriba del reporte. */
function totales(doc: jsPDF, y: number, datos: [string, string][]): number {
  autoTable(doc, {
    startY: y,
    head: [datos.map(([e]) => e)],
    body: [datos.map(([, v]) => v)],
    theme: "grid",
    headStyles: { fillColor: [243, 244, 246], textColor: [107, 114, 128], fontSize: 8, fontStyle: "bold" },
    bodyStyles: { fontSize: 13, fontStyle: "bold", textColor: NAVY },
    margin: { left: 40, right: 40 },
  });
  return finalY(doc, y) + 22;
}

async function guardarPdf(doc: jsPDF, nombre: string) {
  await guardarConDialogoWeb(doc.output("blob"), `${nombre}.pdf`, [{ description: "Documento PDF", accept: { "application/pdf": [".pdf"] } }]);
}

async function guardarExcel(hojas: { nombre: string; filas: (string | number)[][]; anchos?: number[] }[], nombre: string) {
  const libro = XLSX.utils.book_new();
  for (const h of hojas) {
    const hoja = XLSX.utils.aoa_to_sheet(h.filas);
    if (h.anchos) hoja["!cols"] = h.anchos.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(libro, hoja, h.nombre.slice(0, 31));
  }
  const buffer = XLSX.write(libro, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  await guardarConDialogoWeb(new Blob([buffer], { type: TIPO_XLSX }), `${nombre}.xlsx`, [{ description: "Libro de Excel", accept: { [TIPO_XLSX]: [".xlsx"] } }]);
}

// ---------------------------------------------------------------------------------------------
// Reportes → Ventas
// ---------------------------------------------------------------------------------------------

export interface DatosReporteVentas {
  sucursal: string;
  desde: string;
  hasta: string;
  totalVentas: number;
  totalPagos: number;
  productos: { nombre: string; categoria?: string | null; subcategoria?: string | null; unidades: number; variantes?: { descripcion: string; cantidad: number }[] }[];
  metodos: { metodo: string; pagos: number; monto: number }[];
}

function archivoReporte(d: DatosReporteVentas) {
  return `reporte-ventas_${d.desde}_a_${d.hasta}`;
}

const rutaCategoria = (p: { categoria?: string | null; subcategoria?: string | null }) => [p.categoria, p.subcategoria].filter(Boolean).join(" › ");
const textoVariantes = (v?: { descripcion: string; cantidad: number }[]) => (v ?? []).map((x) => `${x.descripcion} ×${x.cantidad}`).join(" · ");

export async function exportarReporteVentasPdf(d: DatosReporteVentas) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  let y = encabezado(doc, "Reporte de ventas", `${d.sucursal} · ${periodoTexto(d.desde, d.hasta)}`);
  y = totales(doc, y, [
    ["Ventas en el rango", dinero(d.totalVentas)],
    ["Pagos registrados", String(d.totalPagos)],
    ["Productos distintos", String(d.productos.length)],
  ]);

  y = titulo(doc, "Ventas por método de pago", y);
  autoTable(doc, {
    startY: y,
    head: [["Método", "Pagos", "Monto", "% del total"]],
    body: d.metodos.map((m) => [m.metodo, String(m.pagos), dinero(m.monto), d.totalVentas > 0 ? `${((m.monto / d.totalVentas) * 100).toFixed(1)}%` : "—"]),
    foot: [["Total", String(d.totalPagos), dinero(d.totalVentas), ""]],
    headStyles: { fillColor: NAVY }, footStyles: { fillColor: [243, 244, 246], textColor: NAVY },
    columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
    didParseCell: derecha(1, 2, 3) as never,
    styles: { fontSize: 10 }, margin: { left: 40, right: 40 },
  });
  y = finalY(doc, y) + 24;

  y = titulo(doc, "Productos vendidos (por unidades)", y);
  autoTable(doc, {
    startY: y,
    head: [["#", "Producto", "Categoría", "Unidades"]],
    body: d.productos.map((p, i) => [
      String(i + 1),
      p.variantes?.length ? `${p.nombre}\n${textoVariantes(p.variantes)}` : p.nombre,
      rutaCategoria(p) || "—",
      String(p.unidades),
    ]),
    headStyles: { fillColor: NARANJA },
    columnStyles: { 0: { cellWidth: 26 }, 3: { halign: "right", fontStyle: "bold" } },
    didParseCell: derecha(3) as never,
    styles: { fontSize: 9, cellPadding: 4 }, margin: { left: 40, right: 40 },
  });
  await guardarPdf(doc, archivoReporte(d));
}

export async function exportarReporteVentasExcel(d: DatosReporteVentas) {
  const resumen: (string | number)[][] = [
    ["HANGAR 421 · Reporte de ventas"],
    ["Sucursal", d.sucursal],
    ["Periodo", periodoTexto(d.desde, d.hasta)],
    [],
    ["Ventas en el rango", redondo(d.totalVentas)],
    ["Pagos registrados", d.totalPagos],
    ["Productos distintos vendidos", d.productos.length],
  ];
  const metodos: (string | number)[][] = [
    ["Método", "Pagos", "Monto"],
    ...d.metodos.map((m) => [m.metodo, m.pagos, redondo(m.monto)]),
    ["Total", d.totalPagos, redondo(d.totalVentas)],
  ];
  const productos: (string | number)[][] = [
    ["Producto", "Categoría", "Subcategoría", "Unidades"],
    ...d.productos.map((p) => [p.nombre, p.categoria ?? "", p.subcategoria ?? "", p.unidades]),
  ];
  const variantes: (string | number)[][] = [
    ["Producto", "Categoría", "Modificadores", "Unidades"],
    ...d.productos.flatMap((p) => (p.variantes?.length ? p.variantes : [{ descripcion: "Sin modificadores", cantidad: p.unidades }]).map((v) => [p.nombre, rutaCategoria(p), v.descripcion, v.cantidad])),
  ];
  await guardarExcel(
    [
      { nombre: "Resumen", filas: resumen, anchos: [30, 26] },
      { nombre: "Métodos de pago", filas: metodos, anchos: [24, 10, 14] },
      { nombre: "Productos", filas: productos, anchos: [34, 22, 22, 10] },
      { nombre: "Por modificadores", filas: variantes, anchos: [34, 30, 40, 10] },
    ],
    archivoReporte(d),
  );
}

// ---------------------------------------------------------------------------------------------
// Módulo Ventas (tickets)
// ---------------------------------------------------------------------------------------------

export interface TicketExportable {
  folio: string;
  fecha: string;
  estado: string;
  origen: string;
  sucursal: string;
  atendio: string;
  dispositivo: string;
  turno: string;
  pagos: { metodo: string; monto: number }[];
  subtotal: number;
  descuento: number;
  impuestos: number;
  total: number;
  items: { nombre: string; cantidad: number; subtotal: number }[];
}

export interface DatosVentasExport {
  sucursal: string;
  desde: string;
  hasta: string;
  zona: string;
  /** Filtros aplicados, ya en texto ("Estado: Cobradas", "Usuario: Dalia Franco"…). */
  filtros: string[];
  resumen: { totalVendido: number; creditoEmpleados: number; numTickets: number; ticketPromedio: number; porEstado: { estado: string; cantidad: number; total: number }[] };
  desglose: { titulo: string; grupos: { nombre: string; numTickets: number; total: number }[] }[];
  /** Transacciones y total por método de pago. El crédito de empleado se marca: no es venta. */
  porMetodo: { metodo: string; nombre: string; numTransacciones: number; total: number; esCredito: boolean }[];
  tickets: TicketExportable[];
  etiquetaMetodo: (m: string) => string;
}

function archivoVentas(d: DatosVentasExport) {
  return `ventas_${d.desde}_a_${d.hasta}`;
}

const textoPagos = (d: DatosVentasExport, t: TicketExportable) => t.pagos.map((p) => `${d.etiquetaMetodo(p.metodo)} ${dinero(p.monto)}`).join(" + ") || "—";

export async function exportarVentasPdf(d: DatosVentasExport) {
  const doc = new jsPDF({ unit: "pt", format: "letter", orientation: "landscape" });
  const sub = `${d.sucursal} · ${periodoTexto(d.desde, d.hasta)}${d.filtros.length ? ` · ${d.filtros.join(" · ")}` : ""}`;
  let y = encabezado(doc, "Ventas", sub);
  const tarjetas: [string, string][] = [
    ["Total vendido", dinero(d.resumen.totalVendido)],
    ["Tickets cobrados", String(d.resumen.numTickets)],
    ["Ticket promedio", dinero(d.resumen.ticketPromedio)],
  ];
  if (d.resumen.creditoEmpleados > 0) tarjetas.push(["Crédito empleados (no es venta)", dinero(d.resumen.creditoEmpleados)]);
  y = totales(doc, y, tarjetas);

  if (d.porMetodo.length > 0) {
    y = titulo(doc, "Resumen por método de pago", y);
    const ventas = d.porMetodo.filter((m) => !m.esCredito);
    autoTable(doc, {
      startY: y,
      head: [["Método", "Transacciones", "Total"]],
      body: d.porMetodo.map((m) => [m.esCredito ? `${m.nombre} (no es venta)` : m.nombre, String(m.numTransacciones), dinero(m.total)]),
      foot: [["Total cobrado", String(ventas.reduce((s, m) => s + m.numTransacciones, 0)), dinero(ventas.reduce((s, m) => s + m.total, 0))]],
      headStyles: { fillColor: NAVY }, footStyles: { fillColor: [243, 244, 246], textColor: NAVY },
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right", fontStyle: "bold" } },
      didParseCell: derecha(1, 2) as never,
      styles: { fontSize: 10 }, margin: { left: 40, right: 40 }, tableWidth: 360,
    });
    y = finalY(doc, y) + 22;
  }

  // Desglose en columnas: plataforma, usuario, dispositivo.
  const anchoPagina = doc.internal.pageSize.getWidth();
  const columnas = d.desglose.filter((g) => g.grupos.length > 0);
  if (columnas.length > 0) {
    const ancho = (anchoPagina - 80 - (columnas.length - 1) * 12) / columnas.length;
    let masBajo = y;
    columnas.forEach((col, i) => {
      autoTable(doc, {
        startY: y,
        head: [[col.titulo, "Tickets", "Total"]],
        body: col.grupos.map((g) => [g.nombre, String(g.numTickets), dinero(g.total)]),
        headStyles: { fillColor: NAVY }, styles: { fontSize: 8, cellPadding: 3 },
        columnStyles: { 1: { halign: "right" }, 2: { halign: "right" } },
        didParseCell: derecha(1, 2) as never,
        margin: { left: 40 + i * (ancho + 12) }, tableWidth: ancho,
      });
      masBajo = Math.max(masBajo, finalY(doc, y));
    });
    y = masBajo + 24;
  }

  y = titulo(doc, `Tickets (${d.tickets.length})`, y);
  autoTable(doc, {
    startY: y,
    head: [["Folio", "Fecha y hora", "Estado", "Origen", "Atendió", "Dispositivo", "Productos", "Pago", "Total"]],
    body: d.tickets.map((t) => [
      t.folio,
      fechaHora(t.fecha, d.zona),
      t.estado,
      t.origen,
      t.atendio,
      t.dispositivo,
      t.items.map((l) => `${l.cantidad}× ${l.nombre}`).join("\n") || "—",
      textoPagos(d, t),
      dinero(t.total),
    ]),
    headStyles: { fillColor: NARANJA },
    styles: { fontSize: 7.5, cellPadding: 3, valign: "top" },
    columnStyles: { 0: { cellWidth: 44 }, 1: { cellWidth: 92 }, 6: { cellWidth: 170 }, 8: { halign: "right", fontStyle: "bold" } },
    didParseCell: (c) => {
      derecha(8)(c as never);
      if (c.section === "body" && c.column.index === 2 && c.cell.raw === "CANCELADO") c.cell.styles.textColor = [220, 38, 38];
    },
    margin: { left: 40, right: 40 },
  });
  await guardarPdf(doc, archivoVentas(d));
}

export async function exportarVentasExcel(d: DatosVentasExport) {
  const resumen: (string | number)[][] = [
    ["HANGAR 421 · Ventas"],
    ["Sucursal", d.sucursal],
    ["Periodo", periodoTexto(d.desde, d.hasta)],
    ...d.filtros.map((f) => ["Filtro", f]),
    [],
    ["Total vendido", redondo(d.resumen.totalVendido)],
    ["Tickets cobrados", d.resumen.numTickets],
    ["Ticket promedio", redondo(d.resumen.ticketPromedio)],
    ["Crédito empleados (no es venta)", redondo(d.resumen.creditoEmpleados)],
    [],
    ["Estado", "Tickets", "Total"],
    ...d.resumen.porEstado.map((e) => [e.estado, e.cantidad, redondo(e.total)]),
  ];
  const ventasMetodo = d.porMetodo.filter((m) => !m.esCredito);
  const metodos: (string | number)[][] = [
    ["Método", "Transacciones", "Total"],
    ...d.porMetodo.map((m) => [m.esCredito ? `${m.nombre} (no es venta)` : m.nombre, m.numTransacciones, redondo(m.total)]),
    ["Total cobrado", ventasMetodo.reduce((s, m) => s + m.numTransacciones, 0), redondo(ventasMetodo.reduce((s, m) => s + m.total, 0))],
  ];
  const desglose: (string | number)[][] = d.desglose.flatMap((g) => [
    [g.titulo, "Tickets", "Total"],
    ...g.grupos.map((x) => [x.nombre, x.numTickets, redondo(x.total)]),
    [],
  ]);
  const tickets: (string | number)[][] = [
    ["Folio", "Fecha y hora", "Estado", "Origen", "Sucursal", "Atendió", "Dispositivo", "Turno", "Pago", "Subtotal", "Descuento", "Impuestos", "Total"],
    ...d.tickets.map((t) => [t.folio, fechaHora(t.fecha, d.zona), t.estado, t.origen, t.sucursal, t.atendio, t.dispositivo, t.turno, textoPagos(d, t), redondo(t.subtotal), redondo(t.descuento), redondo(t.impuestos), redondo(t.total)]),
  ];
  const productos: (string | number)[][] = [
    ["Folio", "Fecha y hora", "Estado", "Producto", "Cantidad", "Importe"],
    ...d.tickets.flatMap((t) => t.items.map((l) => [t.folio, fechaHora(t.fecha, d.zona), t.estado, l.nombre, l.cantidad, redondo(l.subtotal)])),
  ];
  const pagos: (string | number)[][] = [
    ["Folio", "Fecha y hora", "Estado", "Método", "Monto"],
    ...d.tickets.flatMap((t) => t.pagos.map((p) => [t.folio, fechaHora(t.fecha, d.zona), t.estado, d.etiquetaMetodo(p.metodo), redondo(p.monto)])),
  ];
  await guardarExcel(
    [
      { nombre: "Resumen", filas: resumen, anchos: [32, 30, 14] },
      { nombre: "Métodos de pago", filas: metodos, anchos: [32, 14, 14] },
      { nombre: "Desglose", filas: desglose, anchos: [30, 10, 14] },
      { nombre: "Tickets", filas: tickets, anchos: [10, 18, 12, 18, 16, 20, 18, 12, 30, 11, 11, 11, 11] },
      { nombre: "Productos", filas: productos, anchos: [10, 18, 12, 40, 10, 12] },
      { nombre: "Pagos", filas: pagos, anchos: [10, 18, 12, 20, 12] },
    ],
    archivoVentas(d),
  );
}

// ---------------------------------------------------------------------------------------------
// Reportes → DiDi (ganancia real después de la comisión)
// ---------------------------------------------------------------------------------------------

interface TotalesDidi {
  tickets: number;
  bruto: number;
  descuento: number;
  pagadoCliente: number;
  subsidio: number;
  comision: number;
  neto: number;
  porcentajeNeto: number;
}

export interface ReporteDidi {
  rango: { desde: string; hasta: string; zona: string };
  config: { comisionEnLineaPct: number; comisionEfectivoPct: number };
  resumen: TotalesDidi;
  porTipoPago: (TotalesDidi & { tipo: string })[];
  porDia: (TotalesDidi & { dia: string })[];
  /** Horas del día (0–23, zona de la sucursal) con pedidos. */
  porHora?: (TotalesDidi & { hora: number })[];
  porProducto: { productoId: string; nombre: string; unidades: number; bruto: number; pagadoCliente: number; subsidio: number; neto: number; netoPorUnidad: number }[];
  /** Por método de pago real, con la comisión que le toca a cada uno. */
  porMetodo?: { metodo: string; enLinea: boolean; transacciones: number; pagadoCliente: number; subsidio: number; comision: number; neto: number; comisionPct: number }[];
  tickets: {
    id: string; folio: string; fecha: string; sucursal: string; tipoPago: string; bruto: number; descuento: number; pagadoCliente: number; subsidio: number; comision: number; neto: number; productos: string;
    metodos?: string[];
    items?: { productoId: string; nombre: string; cantidad: number; importe: number }[];
    pagos?: { metodo: string; monto: number }[];
  }[];
  subsidios: { productoId: string; nombre: string; monto: number }[];
  configPersonalizada: boolean;
}

export const ETIQUETA_METODO_DIDI: Record<string, string> = {
  EN_LINEA: "Pagado en la app DiDi", TARJETA: "Tarjeta", EFECTIVO: "Efectivo", EFECTIVO_USD: "Dólares", TRANSFERENCIA: "Transferencia", QR: "QR", OTRO: "Otro",
};
export const metodoDidi = (m: string) => ETIQUETA_METODO_DIDI[m] ?? m;
export const ETIQUETA_TIPO_PAGO_DIDI: Record<string, string> = { EN_LINEA: "Tarjeta / app", EFECTIVO: "Efectivo", MIXTO: "Mixto (tarjeta + efectivo)" };
const tipoDidi = (t: string) => ETIQUETA_TIPO_PAGO_DIDI[t] ?? t;
const diaCorto = (d: string) => d.split("-").reverse().join("/");
export const textoHora = (h: number) => `${String(h).padStart(2, "0")}:00–${String((h + 1) % 24).padStart(2, "0")}:00`;

/** Más y menos vendidos por unidades (los menos vendidos solo si hay más productos que el top). */
export function masYMenosVendidos(r: ReporteDidi, cuantos = 5) {
  const orden = [...r.porProducto].sort((a, b) => b.unidades - a.unidades || b.neto - a.neto);
  const mas = orden.slice(0, cuantos);
  const menos = orden.length > cuantos ? orden.slice(-Math.min(cuantos, orden.length - cuantos)).reverse() : [];
  return { mas, menos };
}

/** La hora con más venta (por lo que pagaron los clientes). */
export function horaPico(r: ReporteDidi) {
  return (r.porHora ?? []).reduce<(TotalesDidi & { hora: number }) | null>((m, h) => (!m || h.pagadoCliente > m.pagadoCliente ? h : m), null);
}
export const textoReglaDidi = (c: ReporteDidi["config"]) =>
  `Comisión DiDi sobre el total: ${c.comisionEnLineaPct}% con tarjeta / app · ${c.comisionEfectivoPct}% en efectivo`;

export async function exportarDidiPdf(r: ReporteDidi, sucursal: string) {
  const doc = new jsPDF({ unit: "pt", format: "letter", orientation: "landscape" });
  let y = encabezado(doc, "DiDi · Ganancia real", `${sucursal} · ${periodoTexto(r.rango.desde, r.rango.hasta)} · ${textoReglaDidi(r.config)}`);
  const s = r.resumen;
  y = totales(doc, y, [
    ["Pedidos", String(s.tickets)],
    ["Vendido en DiDi (cliente)", dinero(s.pagadoCliente)],
    ["Subsidio DiDi", dinero(s.subsidio)],
    ["Comisión DiDi", dinero(s.comision)],
    ["Ganancia real", dinero(s.neto)],
    ["% que te queda", `${s.porcentajeNeto.toFixed(1)}%`],
  ]);

  y = titulo(doc, "Detalle como lo da DiDi", y);
  autoTable(doc, {
    startY: y,
    body: [
      ["Precio total del producto sin promoción", dinero(s.bruto)],
      ["Costo de promoción de productos de la tienda", `-${dinero(s.descuento)}`],
      ["Ganancias totales después del descuento", dinero(s.pagadoCliente)],
      ["Subsidio de DiDi en la promoción", dinero(s.subsidio)],
      [`Cargos de DiDi: comisión y distribución (${r.config.comisionEnLineaPct}% tarjeta / ${r.config.comisionEfectivoPct}% efectivo)`, `-${dinero(s.comision)}`],
      ["Ganancias por pedido (monto del recibo)", dinero(s.neto)],
    ],
    theme: "plain",
    styles: { fontSize: 10, cellPadding: 3 },
    columnStyles: { 1: { halign: "right", fontStyle: "bold" } },
    didParseCell: (c) => { if (c.row.index === 5) { c.cell.styles.fillColor = [220, 252, 231]; c.cell.styles.fontStyle = "bold"; } },
    margin: { left: 40 }, tableWidth: 360,
  });
  const yIzq = finalY(doc, y);
  autoTable(doc, {
    startY: y,
    head: [["Método de pago", "Transacciones", "Cobrado", "Comisión", "Ganancia real"]],
    body: (r.porMetodo ?? []).map((m) => [metodoDidi(m.metodo), String(m.transacciones), dinero(m.pagadoCliente), `${dinero(m.comision)} (${m.comisionPct}%)`, dinero(m.neto)]),
    headStyles: { fillColor: NAVY }, styles: { fontSize: 9 },
    columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right", fontStyle: "bold" } },
    didParseCell: derecha(1, 2, 3, 4) as never,
    margin: { left: 420, right: 40 },
  });
  y = Math.max(yIzq, finalY(doc, y)) + 24;

  y = titulo(doc, "Por día", y);
  autoTable(doc, {
    startY: y,
    head: [["Día", "Pedidos", "Precio de lista", "Promociones", "Pagado cliente", "Subsidio", "Comisión", "Ganancia real"]],
    body: r.porDia.map((d) => [diaCorto(d.dia), String(d.tickets), dinero(d.bruto), dinero(d.descuento), dinero(d.pagadoCliente), dinero(d.subsidio), dinero(d.comision), dinero(d.neto)]),
    foot: [["Total", String(s.tickets), dinero(s.bruto), dinero(s.descuento), dinero(s.pagadoCliente), dinero(s.subsidio), dinero(s.comision), dinero(s.neto)]],
    headStyles: { fillColor: NAVY }, footStyles: { fillColor: [243, 244, 246], textColor: NAVY },
    styles: { fontSize: 8.5 },
    columnStyles: Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((i) => [i, { halign: "right" as const }])),
    didParseCell: derecha(1, 2, 3, 4, 5, 6, 7) as never,
    margin: { left: 40, right: 40 },
  });
  y = finalY(doc, y) + 24;

  if (r.porHora?.length) {
    const pico = horaPico(r);
    y = titulo(doc, `Ventas por hora${pico ? ` · hora pico ${textoHora(pico.hora)}` : ""}`, y);
    autoTable(doc, {
      startY: y,
      head: [["Hora", "Pedidos", "Pagado cliente", "Ganancia real"]],
      body: r.porHora.map((h) => [textoHora(h.hora), String(h.tickets), dinero(h.pagadoCliente), dinero(h.neto)]),
      headStyles: { fillColor: NAVY }, styles: { fontSize: 8.5 },
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right", fontStyle: "bold" } },
      didParseCell: (c) => {
        derecha(1, 2, 3)(c as never);
        if (c.section === "body" && pico && r.porHora![c.row.index]?.hora === pico.hora) c.cell.styles.fillColor = [255, 237, 213];
      },
      margin: { left: 40 }, tableWidth: 330,
    });
    const yHoras = finalY(doc, y);
    const { mas, menos } = masYMenosVendidos(r);
    autoTable(doc, {
      startY: y,
      head: [["Más vendidos", "Unidades", "Ganancia"]],
      body: mas.map((p) => [p.nombre, String(p.unidades), dinero(p.neto)]),
      headStyles: { fillColor: [22, 163, 74] }, styles: { fontSize: 8.5 },
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" } }, didParseCell: derecha(1, 2) as never,
      margin: { left: 400, right: 40 },
    });
    let yDer = finalY(doc, y);
    if (menos.length) {
      autoTable(doc, {
        startY: yDer + 10,
        head: [["Menos vendidos", "Unidades", "Ganancia"]],
        body: menos.map((p) => [p.nombre, String(p.unidades), dinero(p.neto)]),
        headStyles: { fillColor: [220, 38, 38] }, styles: { fontSize: 8.5 },
        columnStyles: { 1: { halign: "right" }, 2: { halign: "right" } }, didParseCell: derecha(1, 2) as never,
        margin: { left: 400, right: 40 },
      });
      yDer = finalY(doc, yDer);
    }
    y = Math.max(yHoras, yDer) + 24;
  }

  y = titulo(doc, "Por producto (de mayor a menor ganancia)", y);
  autoTable(doc, {
    startY: y,
    head: [["Producto", "Unidades", "Precio de lista", "Pagado cliente", "Subsidio", "Ganancia real", "Ganancia por unidad"]],
    body: r.porProducto.map((p) => [p.nombre, String(p.unidades), dinero(p.bruto), dinero(p.pagadoCliente), dinero(p.subsidio), dinero(p.neto), dinero(p.netoPorUnidad)]),
    headStyles: { fillColor: NARANJA }, styles: { fontSize: 8.5 },
    columnStyles: Object.fromEntries([1, 2, 3, 4, 5, 6].map((i) => [i, { halign: "right" as const }])),
    didParseCell: derecha(1, 2, 3, 4, 5, 6) as never,
    margin: { left: 40, right: 40 },
  });
  y = finalY(doc, y) + 24;

  y = titulo(doc, `Pedidos (${r.tickets.length})`, y);
  autoTable(doc, {
    startY: y,
    head: [["Folio", "Fecha", "Sucursal", "Pago", "Productos", "Sin promoción", "Promoción tienda", "Después del desc.", "Subsidio", "Cargos DiDi", "Ganancia por pedido"]],
    body: r.tickets.map((t) => [t.folio, fechaHora(t.fecha, r.rango.zona), t.sucursal, t.metodos?.length ? t.metodos.map(metodoDidi).join(" + ") : tipoDidi(t.tipoPago), t.productos, dinero(t.bruto), dinero(t.descuento), dinero(t.pagadoCliente), dinero(t.subsidio), dinero(t.comision), dinero(t.neto)]),
    headStyles: { fillColor: NARANJA }, styles: { fontSize: 7, cellPadding: 2.5, valign: "top" },
    columnStyles: { 4: { cellWidth: 170 }, ...Object.fromEntries([5, 6, 7, 8, 9, 10].map((i) => [i, { halign: "right" as const }])), 10: { halign: "right", fontStyle: "bold" } },
    didParseCell: derecha(5, 6, 7, 8, 9, 10) as never,
    margin: { left: 40, right: 40 },
  });
  await guardarPdf(doc, `didi-ganancia_${r.rango.desde}_a_${r.rango.hasta}`);
}

export async function exportarDidiExcel(r: ReporteDidi, sucursal: string) {
  const s = r.resumen;
  const resumen: (string | number)[][] = [
    ["HANGAR 421 · DiDi · Ganancia real"],
    ["Sucursal", sucursal],
    ["Periodo", periodoTexto(r.rango.desde, r.rango.hasta)],
    ["Regla", textoReglaDidi(r.config)],
    [],
    ["Pedidos", s.tickets],
    ["Precio total del producto sin promoción", redondo(s.bruto)],
    ["Costo de promoción de productos de la tienda", redondo(s.descuento)],
    ["Ganancias totales después del descuento", redondo(s.pagadoCliente)],
    ["Subsidio de DiDi", redondo(s.subsidio)],
    ["Cargos de DiDi (comisión y distribución)", redondo(s.comision)],
    ["Ganancias por pedido (monto del recibo)", redondo(s.neto)],
    ["% que te queda", s.porcentajeNeto / 100],
    [],
    ["Método de pago", "Transacciones", "Cobrado", "Comisión %", "Comisión", "Ganancia real"],
    ...(r.porMetodo ?? []).map((m) => [metodoDidi(m.metodo), m.transacciones, redondo(m.pagadoCliente), m.comisionPct / 100, redondo(m.comision), redondo(m.neto)]),
  ];
  const dias: (string | number)[][] = [
    ["Día", "Pedidos", "Precio de lista", "Promociones", "Pagado cliente", "Subsidio", "Comisión", "Ganancia real"],
    ...r.porDia.map((d) => [diaCorto(d.dia), d.tickets, redondo(d.bruto), redondo(d.descuento), redondo(d.pagadoCliente), redondo(d.subsidio), redondo(d.comision), redondo(d.neto)]),
    ["Total", s.tickets, redondo(s.bruto), redondo(s.descuento), redondo(s.pagadoCliente), redondo(s.subsidio), redondo(s.comision), redondo(s.neto)],
  ];
  const horas: (string | number)[][] = [
    ["Hora", "Pedidos", "Pagado cliente", "Comisión", "Ganancia real"],
    ...(r.porHora ?? []).map((h) => [textoHora(h.hora), h.tickets, redondo(h.pagadoCliente), redondo(h.comision), redondo(h.neto)]),
  ];
  const productos: (string | number)[][] = [
    ["Producto", "Unidades", "Precio de lista", "Pagado cliente", "Subsidio", "Ganancia real", "Ganancia por unidad"],
    ...[...r.porProducto].sort((a, b) => b.unidades - a.unidades).map((p) => [p.nombre, p.unidades, redondo(p.bruto), redondo(p.pagadoCliente), redondo(p.subsidio), redondo(p.neto), redondo(p.netoPorUnidad)]),
  ];
  const tickets: (string | number)[][] = [
    ["Folio", "Fecha y hora", "Sucursal", "Método de pago", "Productos", "Precio sin promoción", "Costo de promoción de la tienda", "Ganancias después del descuento", "Subsidio DiDi", "Cargos de DiDi", "Ganancias por pedido"],
    ...r.tickets.map((t) => [t.folio, fechaHora(t.fecha, r.rango.zona), t.sucursal, t.metodos?.length ? t.metodos.map(metodoDidi).join(" + ") : tipoDidi(t.tipoPago), t.productos, redondo(t.bruto), redondo(t.descuento), redondo(t.pagadoCliente), redondo(t.subsidio), redondo(t.comision), redondo(t.neto)]),
  ];
  await guardarExcel(
    [
      { nombre: "Resumen", filas: resumen, anchos: [36, 14, 14, 12, 14, 12] },
      { nombre: "Por día", filas: dias, anchos: [12, 9, 14, 13, 14, 11, 12, 14] },
      { nombre: "Por hora", filas: horas, anchos: [14, 9, 14, 12, 14] },
      { nombre: "Por producto", filas: productos, anchos: [36, 10, 14, 14, 11, 14, 16] },
      { nombre: "Pedidos", filas: tickets, anchos: [16, 18, 16, 22, 40, 12, 11, 13, 10, 11, 13] },
    ],
    `didi-ganancia_${r.rango.desde}_a_${r.rango.hasta}`,
  );
}
