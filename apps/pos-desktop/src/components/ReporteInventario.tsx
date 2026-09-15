import { useMemo, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import type { NivelInventario } from "@hangar421/shared";

export type TipoDocumentoInventario = "reporte" | "compras";

export interface FilaReporte {
  insumo: { nombre: string; unidadMedida: string; proveedor?: { nombre: string } | null };
  existencia: number;
  minimo: number;
  maximo?: number | null;
  nivel: NivelInventario;
}

const ETIQUETA_NIVEL: Record<NivelInventario, string> = { OPTIMO: "Óptimo", BAJO: "Bajo", CRITICO: "Crítico" };
const COLOR_ESTADO: Record<NivelInventario, { bg: string; texto: string }> = {
  OPTIMO: { bg: "var(--h421-green-bg)", texto: "var(--h421-green)" },
  BAJO: { bg: "var(--h421-amber-bg)", texto: "var(--h421-amber-texto)" },
  CRITICO: { bg: "var(--h421-red-bg)", texto: "var(--h421-red-texto)" },
};

const FILAS_POR_PAGINA = 12;

/** Config por tipo de documento — "reporte" muestra todo el inventario con su Estado; "compras"
 *  solo insumos en Bajo/Crítico con la cantidad sugerida a comprar (hasta el máximo capturado, o
 *  el doble del mínimo si no hay máximo — mismo criterio que calcularNivelInventario). */
const CONFIG: Record<TipoDocumentoInventario, { titulo: string; archivoBase: string; encabezados: string[] }> = {
  reporte: { titulo: "Reporte de Inventario", archivoBase: "reporte-inventario", encabezados: ["Insumo", "Existencia", "Mínimo", "Estado"] },
  compras: { titulo: "Lista de Compras", archivoBase: "lista-de-compras", encabezados: ["Insumo", "Existencia", "Mínimo", "Proveedor", "Sugerido a comprar"] },
};

function calcularSugerido(f: FilaReporte): number {
  const referencia = f.maximo ?? f.minimo * 2;
  return Math.max(0, Math.ceil(referencia - f.existencia));
}

/** Celdas en texto plano en el mismo orden que CONFIG[tipo].encabezados — usado para PDF, Excel
 *  e impresión (a diferencia de la vista en pantalla, ahí no hace falta la píldora de color). */
function celdasTexto(tipo: TipoDocumentoInventario, f: FilaReporte): (string | number)[] {
  if (tipo === "compras") {
    return [f.insumo.nombre, `${f.existencia} ${f.insumo.unidadMedida}`, `${f.minimo} ${f.insumo.unidadMedida}`, f.insumo.proveedor?.nombre ?? "—", calcularSugerido(f)];
  }
  return [f.insumo.nombre, `${f.existencia} ${f.insumo.unidadMedida}`, `${f.minimo} ${f.insumo.unidadMedida}`, ETIQUETA_NIVEL[f.nivel]];
}

function fechaLarga(): string {
  return new Date().toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
}

function arrayBufferABase64(buffer: ArrayBuffer): string {
  let binario = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) binario += String.fromCharCode(bytes[i]);
  return btoa(binario);
}

/** A diferencia del navegador, aquí sí hay un diálogo nativo real de "Guardar como" (Electron,
 *  vía IPC — ver electron/main.ts "archivo:guardar" y preload.ts). */
async function guardarConDialogoNativo(blob: Blob, nombreSugerido: string, filtros: { name: string; extensions: string[] }[]) {
  const buffer = await blob.arrayBuffer();
  const datosBase64 = arrayBufferABase64(buffer);
  return window.hangar.archivo.guardar({ nombreSugerido, datosBase64, filtros });
}

function construirPdf(tipo: TipoDocumentoInventario, filas: FilaReporte[]): jsPDF {
  const { titulo, encabezados } = CONFIG[tipo];
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const anchoPagina = doc.internal.pageSize.getWidth();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(11, 30, 51);
  doc.text("HANGAR 421", 40, 50);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(140, 140, 140);
  doc.text("POS RESTAURANTES", 40, 64);
  doc.text(`Generado el ${fechaLarga()}`, anchoPagina - 40, 50, { align: "right" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(17, 19, 24);
  doc.text(titulo, 40, 100);

  autoTable(doc, {
    startY: 118,
    head: [encabezados],
    body: filas.map((f) => celdasTexto(tipo, f)),
    headStyles: { fillColor: [11, 30, 51] },
    styles: { fontSize: 10, cellPadding: 6 },
    margin: { left: 40, right: 40 },
  });

  return doc;
}

function construirExcelBlob(tipo: TipoDocumentoInventario, filas: FilaReporte[]): Blob {
  const { encabezados } = CONFIG[tipo];
  const datos = filas.map((f) => {
    const celdas = celdasTexto(tipo, f);
    return Object.fromEntries(encabezados.map((h, i) => [h, celdas[i]]));
  });
  const hoja = XLSX.utils.json_to_sheet(datos);
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, CONFIG[tipo].titulo.slice(0, 31));
  const buffer = XLSX.write(libro, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

/** Vista previa tipo hoja carta del reporte de inventario o la lista de compras, con paginación
 *  (efecto de hojear al cambiar de página) y exportación real a PDF/Excel + impresión — mismo
 *  componente que apps/crm-web, salvo cómo se guarda el archivo (aquí, diálogo nativo de
 *  Electron; allá, File System Access API del navegador). */
export function ReporteInventario({ tipo, filas: todasLasFilas, onCerrar }: { tipo: TipoDocumentoInventario; filas: FilaReporte[]; onCerrar: () => void }) {
  const [paginaActual, setPaginaActual] = useState(0);
  const [animacion, setAnimacion] = useState<"" | "hojeando-siguiente" | "hojeando-anterior">("");
  const [generando, setGenerando] = useState<"" | "pdf" | "excel">("");

  const { titulo, archivoBase, encabezados } = CONFIG[tipo];
  const filas = useMemo(() => (tipo === "compras" ? todasLasFilas.filter((f) => f.nivel !== "OPTIMO") : todasLasFilas), [todasLasFilas, tipo]);

  const totalPaginas = Math.max(1, Math.ceil(filas.length / FILAS_POR_PAGINA));
  const filasPagina = useMemo(
    () => filas.slice(paginaActual * FILAS_POR_PAGINA, (paginaActual + 1) * FILAS_POR_PAGINA),
    [filas, paginaActual],
  );

  function irA(pagina: number, direccion: "hojeando-siguiente" | "hojeando-anterior") {
    if (pagina < 0 || pagina >= totalPaginas || animacion) return;
    setAnimacion(direccion);
    setTimeout(() => setPaginaActual(pagina), 250);
    setTimeout(() => setAnimacion(""), 520);
  }

  async function exportarPdf() {
    setGenerando("pdf");
    try {
      const doc = construirPdf(tipo, filas);
      const nombre = `${archivoBase}-${new Date().toISOString().slice(0, 10)}.pdf`;
      await guardarConDialogoNativo(doc.output("blob"), nombre, [{ name: "Documento PDF", extensions: ["pdf"] }]);
    } finally {
      setGenerando("");
    }
  }

  async function exportarExcel() {
    setGenerando("excel");
    try {
      const blob = construirExcelBlob(tipo, filas);
      const nombre = `${archivoBase}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      await guardarConDialogoNativo(blob, nombre, [{ name: "Libro de Excel", extensions: ["xlsx"] }]);
    } finally {
      setGenerando("");
    }
  }

  function enviarPorCorreo() {
    // Limitación real: un mailto: no puede llevar un archivo adjunto (restricción del sistema
    // operativo/cliente de correo, no de esta app) — abre el cliente de correo con el mensaje
    // listo y el PDF se descarga aparte para adjuntarlo a mano. Adjuntarlo automáticamente
    // requeriría un servicio de envío de correo (SMTP/SendGrid) configurado en el backend.
    exportarPdf();
    const asunto = encodeURIComponent(`${titulo} - HANGAR 421`);
    const cuerpo = encodeURIComponent(`Adjunto ${titulo.toLowerCase()} generado el ${fechaLarga()}.\n\n(El PDF se guardó por separado — adjúntalo a este correo antes de enviarlo.)`);
    window.hangar.abrirExterno(`mailto:?subject=${asunto}&body=${cuerpo}`);
  }

  function imprimir() {
    window.print();
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 16 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, maxHeight: "95vh" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, background: "var(--h421-white)", padding: 10, borderRadius: 12 }}>
          <button onClick={onCerrar} style={{ background: "var(--h421-gray-50)", padding: "10px 16px", fontSize: 13, minHeight: 0 }}>Cancelar</button>
          <button onClick={enviarPorCorreo} style={{ background: "transparent", color: "var(--h421-blue)", border: "1px solid var(--h421-blue)", padding: "10px 16px", fontSize: 13, minHeight: 0 }}>✉️ Enviar por correo</button>
          <button onClick={exportarPdf} disabled={!!generando} style={{ background: "transparent", color: "inherit", border: "1px solid var(--h421-gray-400)", padding: "10px 16px", fontSize: 13, minHeight: 0 }}>{generando === "pdf" ? "Generando…" : "Exportar PDF"}</button>
          <button onClick={exportarExcel} disabled={!!generando} style={{ background: "transparent", color: "var(--h421-green)", border: "1px solid var(--h421-green)", padding: "10px 16px", fontSize: 13, minHeight: 0 }}>{generando === "excel" ? "Generando…" : "Exportar Excel"}</button>
          <button onClick={imprimir} style={{ background: "var(--h421-navy)", color: "#fff", padding: "10px 16px", fontSize: 13, minHeight: 0 }}>🖨️ Imprimir</button>
        </div>

        <div style={{ overflowY: "auto", maxHeight: "calc(95vh - 70px)", perspective: 1600 }}>
          <div
            className={`h421-hoja-carta ${animacion}`}
            style={{
              width: "8.5in", minHeight: "11in", background: "#fff", color: "#111318", padding: "0.7in",
              boxShadow: "0 10px 40px rgba(0,0,0,0.35)", boxSizing: "border-box",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "2px solid #0b1e33", paddingBottom: 14 }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 800, color: "#0b1e33" }}>HANGAR 421</div>
                <div style={{ fontSize: 11, color: "#9ca3af", letterSpacing: 1 }}>POS RESTAURANTES</div>
              </div>
              <div style={{ fontSize: 12, color: "#9ca3af" }}>Generado el {fechaLarga()}</div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "22px 0 16px" }}>
              <div>
                <h1 style={{ margin: 0, fontSize: 24 }}>{titulo}</h1>
                <div style={{ width: 48, height: 3, background: "#0b1e33", marginTop: 6 }} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 13 }}>
                <button onClick={() => irA(paginaActual - 1, "hojeando-anterior")} disabled={paginaActual === 0 || !!animacion}
                  style={{ background: "none", color: paginaActual === 0 ? "#9ca3af" : "#0b1e33", padding: "6px 10px", minHeight: 0 }}>← Anterior</button>
                <span>Página {paginaActual + 1} de {totalPaginas}</span>
                <button onClick={() => irA(paginaActual + 1, "hojeando-siguiente")} disabled={paginaActual >= totalPaginas - 1 || !!animacion}
                  style={{ background: "#f6f7f8", color: "#111318", padding: "6px 10px", border: "1px solid #e5e7eb", minHeight: 0 }}>Siguiente →</button>
              </div>
            </div>

            {filas.length === 0 ? (
              <p style={{ color: "#9ca3af", textAlign: "center", padding: "40px 0" }}>
                No hay insumos en nivel bajo o crítico — todo el inventario está en niveles óptimos.
              </p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#0b1e33", color: "#fff", textAlign: "left" }}>
                    {encabezados.map((h) => <th key={h} style={{ padding: 10 }}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {filasPagina.map((f, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #e5e7eb", background: i % 2 === 1 ? "#f6f7f8" : undefined }}>
                      <td style={{ padding: 10, fontWeight: 600 }}>{f.insumo.nombre}</td>
                      <td style={{ padding: 10 }}>{f.existencia} {f.insumo.unidadMedida}</td>
                      <td style={{ padding: 10 }}>{f.minimo} {f.insumo.unidadMedida}</td>
                      {tipo === "compras" ? (
                        <>
                          <td style={{ padding: 10 }}>{f.insumo.proveedor?.nombre ?? "—"}</td>
                          <td style={{ padding: 10, fontWeight: 700 }}>{calcularSugerido(f)} {f.insumo.unidadMedida}</td>
                        </>
                      ) : (
                        <td style={{ padding: 10 }}>
                          <span style={{ background: COLOR_ESTADO[f.nivel].bg, color: COLOR_ESTADO[f.nivel].texto, padding: "3px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700 }}>{ETIQUETA_NIVEL[f.nivel]}</span>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Versión completa (todas las filas, sin paginar) para @media print — la vista de arriba
          solo muestra una "página" a la vez y no debe ser lo que sale al imprimir. */}
      <div id="reporte-imprimible">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "2px solid #0b1e33", paddingBottom: 14 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#0b1e33" }}>HANGAR 421</div>
            <div style={{ fontSize: 11, color: "#9ca3af", letterSpacing: 1 }}>POS RESTAURANTES</div>
          </div>
          <div style={{ fontSize: 12, color: "#9ca3af" }}>Generado el {fechaLarga()}</div>
        </div>
        <h1 style={{ fontSize: 24, margin: "22px 0 16px" }}>{titulo}</h1>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#0b1e33", color: "#fff", textAlign: "left" }}>
              {encabezados.map((h) => <th key={h} style={{ padding: 10 }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #e5e7eb" }}>
                {celdasTexto(tipo, f).map((c, j) => <td key={j} style={{ padding: 10 }}>{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
