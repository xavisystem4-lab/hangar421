import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { costoEnUnidadCaptura, type CompraRegistro, type ResumenCompras } from "@hangar421/shared";
import { guardarConDialogoWeb } from "@/components/ReporteInventario";

/**
 * Exportación del módulo Compras y costos (PDF, Excel y CSV): nombre del negocio, periodo,
 * fecha de generación, filtros aplicados, detalle de compras y totales.
 */

export interface DatosExportCompras {
  negocio: string;
  sucursal: string;
  desde: string;
  hasta: string;
  filtros: string[];
  compras: CompraRegistro[];
  resumen: ResumenCompras;
}

const TIPO_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const NAVY: [number, number, number] = [11, 30, 51];
const NARANJA: [number, number, number] = [255, 106, 19];
const dinero = (n: number) => `$${(Number(n) || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const cant = (n: number) => (Number(n) || 0).toLocaleString("es-MX", { maximumFractionDigits: 4 });
const fecha = (iso: string) => new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "2-digit", year: "numeric" });
const periodo = (d: DatosExportCompras) => {
  const f = (x: string) => x.split("-").reverse().join("/");
  return d.desde === d.hasta ? f(d.desde) : `${f(d.desde)} al ${f(d.hasta)}`;
};
const archivo = (d: DatosExportCompras) => `compras-insumos_${d.desde}_a_${d.hasta}`;
const generado = () => new Date().toLocaleString("es-MX", { dateStyle: "long", timeStyle: "short" });

/** Filas de detalle (una por compra), compartidas por Excel y CSV. */
function filasDetalle(d: DatosExportCompras): (string | number)[][] {
  return [
    ["Fecha", "Insumo", "Categoría", "Cantidad", "Unidad", "Precio unitario", "Total", "Entra al inventario", "Unidad base", "Costo por unidad base", "Proveedor", "Registró", "Sucursal", "Estado", "Notas"],
    ...d.compras.map((c) => [
      fecha(c.fechaCompra), c.insumo, c.categoria, c.cantidadCaptura, c.unidadCaptura, c.precioCaptura, c.total, c.cantidadBase, c.unidadBase,
      c.costoUnitarioBase, c.proveedor ?? "", c.usuario ?? "", c.sucursal ?? "", c.estado === "ANULADA" ? "Anulada" : "Vigente", (c as { notas?: string | null }).notas ?? "",
    ]),
  ];
}

function filasPorInsumo(d: DatosExportCompras): (string | number)[][] {
  return [
    ["Insumo", "Categoría", "Compras", "Cantidad comprada", "Unidad", "Invertido", "Precio promedio", "Último precio", "Mínimo", "Máximo", "Variación %", "Por unidad de"],
    ...d.resumen.porInsumo.map((i) => [
      i.insumo, i.categoria, i.compras, Math.round((i.cantidadBase / i.factorCaptura) * 10_000) / 10_000, i.unidadCaptura, i.total,
      costoEnUnidadCaptura(i.costoPromedioBase, i.factorCaptura), costoEnUnidadCaptura(i.ultimoCostoBase, i.factorCaptura),
      costoEnUnidadCaptura(i.minimoBase, i.factorCaptura), costoEnUnidadCaptura(i.maximoBase, i.factorCaptura), i.variacionPct, i.unidadCaptura,
    ]),
  ];
}

export async function exportarComprasPdf(d: DatosExportCompras) {
  const doc = new jsPDF({ unit: "pt", format: "letter", orientation: "landscape" });
  const ancho = doc.internal.pageSize.getWidth();
  doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.setTextColor(...NAVY);
  doc.text(`${d.negocio} · Compras y costos de insumos`, 40, 46);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(107, 114, 128);
  doc.text(`${d.sucursal} · ${periodo(d)}${d.filtros.length ? ` · ${d.filtros.join(" · ")}` : ""}`, 40, 64);
  doc.setFontSize(8); doc.text(`Generado el ${generado()}`, ancho - 40, 46, { align: "right" });
  doc.setDrawColor(...NARANJA); doc.setLineWidth(2); doc.line(40, 74, ancho - 40, 74);

  autoTable(doc, {
    startY: 86, head: [["Total invertido", "Compras registradas", "Insumos distintos"]],
    body: [[dinero(d.resumen.total), String(d.resumen.compras), String(d.resumen.porInsumo.length)]], theme: "grid",
    headStyles: { fillColor: [243, 244, 246], textColor: [107, 114, 128], fontSize: 8 }, bodyStyles: { fontSize: 13, fontStyle: "bold", textColor: NAVY },
    margin: { left: 40, right: 40 },
  });
  const y = () => ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 100) + 22;
  const titulo = (t: string) => { let yy = y(); if (yy > doc.internal.pageSize.getHeight() - 80) { doc.addPage(); yy = 50; } doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(...NAVY); doc.text(t, 40, yy); return yy + 8; };

  const porInsumo = filasPorInsumo(d);
  autoTable(doc, {
    startY: titulo("Por insumo"), head: [porInsumo[0].slice(0, 11).map(String)],
    body: porInsumo.slice(1).map((f) => [f[0], f[1], f[2], `${cant(Number(f[3]))} ${f[4]}`, f[4], dinero(Number(f[5])), dinero(Number(f[6])), dinero(Number(f[7])), dinero(Number(f[8])), dinero(Number(f[9])), `${Number(f[10]) > 0 ? "+" : ""}${f[10]}%`].map(String)),
    headStyles: { fillColor: NAVY }, styles: { fontSize: 8, cellPadding: 3 }, margin: { left: 40, right: 40 },
  });
  autoTable(doc, {
    startY: titulo("Detalle de compras"),
    head: [["Fecha", "Insumo", "Cantidad", "Precio", "Total", "Proveedor", "Registró", "Sucursal", "Estado"]],
    body: d.compras.map((c) => [fecha(c.fechaCompra), c.insumo, `${cant(c.cantidadCaptura)} ${c.unidadCaptura}`, dinero(c.precioCaptura), dinero(c.total), c.proveedor ?? "—", c.usuario ?? "—", c.sucursal ?? "—", c.estado === "ANULADA" ? "Anulada" : ""]),
    foot: [["", "", "", "Total", dinero(d.resumen.total), "", "", "", ""]],
    headStyles: { fillColor: NAVY }, footStyles: { fillColor: [243, 244, 246], textColor: NAVY, fontStyle: "bold" }, styles: { fontSize: 8, cellPadding: 3 },
    columnStyles: { 3: { halign: "right" }, 4: { halign: "right", fontStyle: "bold" } }, margin: { left: 40, right: 40 },
  });
  await guardarConDialogoWeb(doc.output("blob"), `${archivo(d)}.pdf`, [{ description: "Documento PDF", accept: { "application/pdf": [".pdf"] } }]);
}

export async function exportarComprasExcel(d: DatosExportCompras) {
  const libro = XLSX.utils.book_new();
  const resumen: (string | number)[][] = [
    [`${d.negocio} · Compras y costos de insumos`], ["Sucursal", d.sucursal], ["Periodo", periodo(d)], ["Filtros", d.filtros.join(" · ") || "Ninguno"], ["Generado", generado()], [],
    ["Total invertido", d.resumen.total], ["Compras registradas", d.resumen.compras], [],
    ["Por mes", "Compras", "Total"], ...d.resumen.porMes.map((m) => [m.mes, m.compras, m.total]), [],
    ["Por categoría", "Compras", "Total", "%"], ...d.resumen.porCategoria.map((g) => [g.clave, g.compras, g.total, g.porcentaje]), [],
    ["Por proveedor", "Compras", "Total", "%"], ...d.resumen.porProveedor.map((g) => [g.clave, g.compras, g.total, g.porcentaje]),
  ];
  const hojas: [string, (string | number)[][], number[]][] = [
    ["Resumen", resumen, [26, 14, 14, 8]],
    ["Por insumo", filasPorInsumo(d), [30, 18, 9, 14, 10, 14, 14, 14, 12, 12, 11, 12]],
    ["Detalle", filasDetalle(d), [12, 30, 16, 10, 10, 14, 12, 14, 10, 14, 18, 14, 14, 10, 24]],
  ];
  for (const [nombre, filas, anchos] of hojas) {
    const hoja = XLSX.utils.aoa_to_sheet(filas);
    hoja["!cols"] = anchos.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(libro, hoja, nombre);
  }
  const buffer = XLSX.write(libro, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  await guardarConDialogoWeb(new Blob([buffer], { type: TIPO_XLSX }), `${archivo(d)}.xlsx`, [{ description: "Libro de Excel", accept: { [TIPO_XLSX]: [".xlsx"] } }]);
}

export async function exportarComprasCsv(d: DatosExportCompras) {
  const encabezado = [[`${d.negocio} · Compras y costos de insumos`], [`Sucursal: ${d.sucursal}`], [`Periodo: ${periodo(d)}`], [`Filtros: ${d.filtros.join(" · ") || "Ninguno"}`], [`Generado: ${generado()}`], []];
  const filas = [...encabezado, ...filasDetalle(d), [], ["", "", "", "", "", "Total", d.resumen.total]];
  const csv = filas.map((f) => f.map((v) => {
    const s = String(v ?? "");
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",")).join("\r\n");
  // BOM para que Excel abra bien los acentos.
  await guardarConDialogoWeb(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }), `${archivo(d)}.csv`, [{ description: "CSV", accept: { "text/csv": [".csv"] } }]);
}
