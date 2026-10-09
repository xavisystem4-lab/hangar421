"use client";

import { useEffect, useMemo, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import type { NivelInventario } from "@hangar421/shared";
import { resumenSemaforoInventario } from "@hangar421/shared";
import { apiFetch } from "@/lib/api";
import { useAuthCrm } from "@/lib/authClient";

export type TipoDocumentoInventario = "reporte" | "compras";

export interface FilaReporte {
  insumo: { nombre: string; unidadMedida: string; proveedor?: { nombre: string } | null };
  existencia: number;
  minimo: number;
  maximo?: number | null;
  nivel: NivelInventario;
}

export const ETIQUETA_NIVEL: Record<NivelInventario, string> = { OPTIMO: "Óptimo", BAJO: "Bajo", CRITICO: "Crítico" };
/** Semáforo: verde óptimo · amarillo bajo · rojo crítico. Colores fijos (no variables de tema)
 *  porque también van al PDF y al correo, que no saben de modo día/noche. */
export const SEMAFORO: Record<NivelInventario, { color: string; fondo: string; etiqueta: string; rgb: [number, number, number]; rgbFondo: [number, number, number] }> = {
  OPTIMO: { color: "#15803d", fondo: "#dcfce7", etiqueta: "VERDE · ÓPTIMO", rgb: [21, 128, 61], rgbFondo: [220, 252, 231] },
  BAJO: { color: "#b45309", fondo: "#fef3c7", etiqueta: "AMARILLO · BAJO", rgb: [180, 83, 9], rgbFondo: [254, 243, 199] },
  CRITICO: { color: "#b91c1c", fondo: "#fee2e2", etiqueta: "ROJO · CRÍTICO", rgb: [185, 28, 28], rgbFondo: [254, 226, 226] },
};
const ORDEN_NIVEL: Record<NivelInventario, number> = { CRITICO: 0, BAJO: 1, OPTIMO: 2 };

const FILAS_POR_PAGINA = 12;
const CLAVE_DESTINATARIOS = "hangar421_crm_reporte_destinatarios";

/** Config por tipo de documento — "reporte" muestra todo el inventario con su Estado; "compras"
 *  solo insumos en Bajo/Crítico con la cantidad sugerida a comprar (hasta el máximo capturado, o
 *  el doble del mínimo si no hay máximo — mismo criterio que calcularNivelInventario). */
const CONFIG: Record<TipoDocumentoInventario, { titulo: string; archivoBase: string; encabezados: string[]; columnaEstado: number }> = {
  reporte: { titulo: "Reporte de Inventario", archivoBase: "reporte-inventario", encabezados: ["Insumo", "Existencia", "Mínimo", "Estado"], columnaEstado: 3 },
  compras: { titulo: "Lista de Compras", archivoBase: "lista-de-compras", encabezados: ["Insumo", "Existencia", "Mínimo", "Estado", "Proveedor", "Comprar"], columnaEstado: 3 },
};

export function calcularSugerido(f: FilaReporte): number {
  const referencia = f.maximo ?? f.minimo * 2;
  return Math.max(0, Math.ceil(referencia - f.existencia));
}

/** Celdas en texto plano en el mismo orden que CONFIG[tipo].encabezados — usado para PDF, Excel
 *  e impresión (a diferencia de la vista en pantalla, ahí no hace falta la píldora de color). */
function celdasTexto(tipo: TipoDocumentoInventario, f: FilaReporte): (string | number)[] {
  const base = [f.insumo.nombre, `${f.existencia} ${f.insumo.unidadMedida}`, `${f.minimo} ${f.insumo.unidadMedida}`, ETIQUETA_NIVEL[f.nivel]];
  if (tipo === "compras") return [...base, f.insumo.proveedor?.nombre ?? "—", `${calcularSugerido(f)} ${f.insumo.unidadMedida}`];
  return base;
}

function fechaLarga(): string {
  return new Date().toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
}

function horaCorta(): string {
  return new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}

/** Guarda un blob eligiendo dónde en disco cuando el navegador lo permite (File System Access
 *  API — Chrome/Edge de escritorio); en navegadores sin soporte (Firefox, Safari, o si el usuario
 *  cancela con Escape en vez de aceptar) cae a la descarga normal del navegador, que va a la
 *  carpeta de Descargas salvo que el propio navegador esté configurado para preguntar siempre. */
async function guardarConDialogoWeb(blob: Blob, nombreSugerido: string, tipos: { description: string; accept: Record<string, string[]> }[]) {
  const w = window as unknown as { showSaveFilePicker?: (opciones: unknown) => Promise<FileSystemFileHandleLike> };
  if (w.showSaveFilePicker) {
    try {
      const handle = await w.showSaveFilePicker({ suggestedName: nombreSugerido, types: tipos });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return; // el usuario canceló el diálogo
      // cualquier otro error (navegador que anuncia soporte pero falla) cae al método de abajo
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreSugerido;
  a.click();
  URL.revokeObjectURL(url);
}

interface FileSystemFileHandleLike {
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
}

function construirPdf(tipo: TipoDocumentoInventario, filas: FilaReporte[], sucursalNombre?: string): jsPDF {
  const { titulo, encabezados, columnaEstado } = CONFIG[tipo];
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const anchoPagina = doc.internal.pageSize.getWidth();
  const resumen = resumenSemaforoInventario(filas.map((f) => f.nivel));

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(11, 30, 51);
  doc.text("HANGAR 421", 40, 50);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(140, 140, 140);
  doc.text(sucursalNombre ? `POS RESTAURANTES · ${sucursalNombre}` : "POS RESTAURANTES", 40, 64);
  doc.text(`Generado el ${fechaLarga()} a las ${horaCorta()}`, anchoPagina - 40, 50, { align: "right" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(17, 19, 24);
  doc.text(titulo, 40, 100);

  // Semáforo: tres recuadros con el conteo por color, igual que en pantalla y en el correo.
  const anchoCaja = (anchoPagina - 80 - 20) / 3;
  (["OPTIMO", "BAJO", "CRITICO"] as NivelInventario[]).forEach((nivel, i) => {
    const x = 40 + i * (anchoCaja + 10);
    const s = SEMAFORO[nivel];
    doc.setFillColor(...s.rgbFondo);
    doc.roundedRect(x, 114, anchoCaja, 54, 6, 6, "F");
    doc.setTextColor(...s.rgb);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(26);
    const numero = nivel === "OPTIMO" ? resumen.optimo : nivel === "BAJO" ? resumen.bajo : resumen.critico;
    doc.text(String(numero), x + anchoCaja / 2, 146, { align: "center" });
    doc.setFontSize(8);
    doc.text(s.etiqueta, x + anchoCaja / 2, 160, { align: "center" });
  });

  autoTable(doc, {
    startY: 184,
    head: [encabezados],
    body: filas.map((f) => celdasTexto(tipo, f)),
    headStyles: { fillColor: [11, 30, 51] },
    styles: { fontSize: 10, cellPadding: 6 },
    columnStyles: { 1: { fontStyle: "bold" }, [columnaEstado]: { halign: "center", fontStyle: "bold" } },
    margin: { left: 40, right: 40 },
    didParseCell: (datos) => {
      if (datos.section !== "body") return;
      const fila = filas[datos.row.index];
      if (!fila) return;
      const s = SEMAFORO[fila.nivel];
      if (datos.column.index === columnaEstado) {
        datos.cell.styles.fillColor = s.rgbFondo;
        datos.cell.styles.textColor = s.rgb;
      } else if (datos.column.index === 1) {
        datos.cell.styles.textColor = s.rgb;
      }
    },
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

interface EstadoCorreo {
  configurado: boolean;
  proveedor: "smtp" | "resend" | null;
  remitente: string | null;
  detalle: string;
}

/** Vista previa tipo hoja carta del reporte de inventario o la lista de compras, con semáforo
 *  (verde óptimo / amarillo bajo / rojo crítico), paginación, exportación a PDF/Excel, impresión
 *  y envío por correo con el PDF adjunto (lo manda el backend — ver CorreoService; si el servidor
 *  no tiene correo configurado se ofrece abrir el correo del usuario con el PDF descargado). */
export function ReporteInventario({ tipo, filas: todasLasFilas, sucursalId, sucursalNombre, onCerrar }: {
  tipo: TipoDocumentoInventario;
  filas: FilaReporte[];
  sucursalId: string;
  sucursalNombre?: string;
  onCerrar: () => void;
}) {
  const { contexto } = useAuthCrm();
  const [paginaActual, setPaginaActual] = useState(0);
  const [animacion, setAnimacion] = useState<"" | "hojeando-siguiente" | "hojeando-anterior">("");
  const [generando, setGenerando] = useState<"" | "pdf" | "excel">("");

  const [modalCorreo, setModalCorreo] = useState(false);
  const [estadoCorreo, setEstadoCorreo] = useState<EstadoCorreo | null>(null);
  const [destinatarios, setDestinatarios] = useState("");
  const [mensajeCorreo, setMensajeCorreo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [resultadoCorreo, setResultadoCorreo] = useState<{ ok: boolean; texto: string } | null>(null);

  const { titulo, archivoBase, encabezados } = CONFIG[tipo];
  // Rojo primero, luego amarillo, luego verde: lo urgente arriba tanto en el reporte como en la
  // lista de compras (que además omite lo que está en verde).
  const filas = useMemo(
    () => (tipo === "compras" ? todasLasFilas.filter((f) => f.nivel !== "OPTIMO") : [...todasLasFilas]).sort((a, b) => ORDEN_NIVEL[a.nivel] - ORDEN_NIVEL[b.nivel] || a.insumo.nombre.localeCompare(b.insumo.nombre, "es")),
    [todasLasFilas, tipo],
  );
  const resumen = useMemo(() => resumenSemaforoInventario(filas.map((f) => f.nivel)), [filas]);

  const totalPaginas = Math.max(1, Math.ceil(filas.length / FILAS_POR_PAGINA));
  const filasPagina = useMemo(
    () => filas.slice(paginaActual * FILAS_POR_PAGINA, (paginaActual + 1) * FILAS_POR_PAGINA),
    [filas, paginaActual],
  );

  useEffect(() => {
    // Destinatarios: los últimos usados en este navegador, o el correo de quien está dentro.
    const correoUsuario = (contexto?.usuario as { email?: string } | undefined)?.email ?? "";
    try {
      setDestinatarios(localStorage.getItem(CLAVE_DESTINATARIOS) || correoUsuario);
    } catch {
      setDestinatarios(correoUsuario);
    }
  }, [contexto?.usuario]);

  function irA(pagina: number, direccion: "hojeando-siguiente" | "hojeando-anterior") {
    if (pagina < 0 || pagina >= totalPaginas || animacion) return;
    setAnimacion(direccion);
    setTimeout(() => setPaginaActual(pagina), 250);
    setTimeout(() => setAnimacion(""), 520);
  }

  const nombreArchivoPdf = () => `${archivoBase}-${new Date().toISOString().slice(0, 10)}.pdf`;

  async function exportarPdf() {
    setGenerando("pdf");
    try {
      const doc = construirPdf(tipo, filas, sucursalNombre);
      await guardarConDialogoWeb(doc.output("blob"), nombreArchivoPdf(), [{ description: "Documento PDF", accept: { "application/pdf": [".pdf"] } }]);
    } finally {
      setGenerando("");
    }
  }

  async function exportarExcel() {
    setGenerando("excel");
    try {
      const blob = construirExcelBlob(tipo, filas);
      const nombre = `${archivoBase}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      await guardarConDialogoWeb(blob, nombre, [{ description: "Libro de Excel", accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] } }]);
    } finally {
      setGenerando("");
    }
  }

  async function abrirCorreo() {
    setResultadoCorreo(null);
    setModalCorreo(true);
    if (!estadoCorreo) {
      try {
        setEstadoCorreo(await apiFetch<EstadoCorreo>("/inventario/reporte/correo"));
      } catch {
        setEstadoCorreo({ configurado: false, proveedor: null, remitente: null, detalle: "No se pudo consultar la configuración de correo del servidor." });
      }
    }
  }

  async function enviarPorCorreo() {
    if (!destinatarios.trim()) { setResultadoCorreo({ ok: false, texto: "Captura al menos un correo." }); return; }
    setEnviando(true);
    setResultadoCorreo(null);
    try {
      const doc = construirPdf(tipo, filas, sucursalNombre);
      const pdfBase64 = doc.output("datauristring").split(",")[1];
      const pendientes = filas
        .filter((f) => f.nivel !== "OPTIMO")
        .map((f) => ({ nombre: f.insumo.nombre, existencia: f.existencia, unidad: f.insumo.unidadMedida, minimo: f.minimo, nivel: f.nivel as "BAJO" | "CRITICO", sugerido: calcularSugerido(f) }));
      const r = await apiFetch<{ enviadoA: string[] }>("/inventario/reporte/enviar", {
        method: "POST",
        body: JSON.stringify({ sucursalId, tipo, destinatarios, mensaje: mensajeCorreo.trim() || undefined, resumen, pendientes, pdfBase64, nombreArchivo: nombreArchivoPdf() }),
      });
      try { localStorage.setItem(CLAVE_DESTINATARIOS, destinatarios.trim()); } catch { /* sin almacenamiento */ }
      setResultadoCorreo({ ok: true, texto: `Enviado a ${r.enviadoA.join(", ")}.` });
    } catch (e) {
      setResultadoCorreo({ ok: false, texto: (e as Error)?.message || "No se pudo enviar el correo." });
    } finally {
      setEnviando(false);
    }
  }

  function abrirCorreoManual() {
    // Sin servidor de correo configurado: un enlace mailto: no puede llevar adjunto (restricción
    // del navegador), así que se descarga el PDF y se abre el correo del usuario con el resumen
    // del semáforo en el cuerpo para que lo adjunte a mano.
    exportarPdf();
    const asunto = encodeURIComponent(`${titulo} - HANGAR 421${sucursalNombre ? ` - ${sucursalNombre}` : ""}`);
    const lineas = [
      `${titulo} generado el ${fechaLarga()} a las ${horaCorta()}.`,
      `Verde óptimo: ${resumen.optimo} · Amarillo bajo: ${resumen.bajo} · Rojo crítico: ${resumen.critico}`,
      "",
      ...filas.filter((f) => f.nivel !== "OPTIMO").map((f) => `- [${ETIQUETA_NIVEL[f.nivel].toUpperCase()}] ${f.insumo.nombre}: ${f.existencia} ${f.insumo.unidadMedida} (mínimo ${f.minimo})${tipo === "compras" ? ` → comprar ${calcularSugerido(f)} ${f.insumo.unidadMedida}` : ""}`),
      "",
      "(El PDF se descargó por separado — adjúntalo a este correo antes de enviarlo.)",
    ];
    window.location.href = `mailto:${encodeURIComponent(destinatarios.trim())}?subject=${asunto}&body=${encodeURIComponent(lineas.join("\n"))}`;
  }

  function imprimir() {
    window.print();
  }

  const Pildora = ({ nivel }: { nivel: NivelInventario }) => (
    <span style={{ background: SEMAFORO[nivel].fondo, color: SEMAFORO[nivel].color, padding: "3px 10px", borderRadius: 999, fontSize: 12, fontWeight: 800, whiteSpace: "nowrap" }}>
      ● {ETIQUETA_NIVEL[nivel]}
    </span>
  );

  const Semaforo = () => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, margin: "14px 0 18px" }}>
      {(["OPTIMO", "BAJO", "CRITICO"] as NivelInventario[]).map((nivel) => (
        <div key={nivel} style={{ background: SEMAFORO[nivel].fondo, color: SEMAFORO[nivel].color, borderRadius: 10, padding: "10px 12px", textAlign: "center" }}>
          <div style={{ fontSize: 30, fontWeight: 800, lineHeight: 1 }}>{nivel === "OPTIMO" ? resumen.optimo : nivel === "BAJO" ? resumen.bajo : resumen.critico}</div>
          <div style={{ fontSize: 11, fontWeight: 800, marginTop: 4, letterSpacing: 0.5 }}>{SEMAFORO[nivel].etiqueta}</div>
        </div>
      ))}
    </div>
  );

  const Encabezado = () => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "2px solid #0b1e33", paddingBottom: 14 }}>
      <div>
        <div style={{ fontSize: 20, fontWeight: 800, color: "#0b1e33" }}>HANGAR 421</div>
        <div style={{ fontSize: 11, color: "#9ca3af", letterSpacing: 1 }}>POS RESTAURANTES{sucursalNombre ? ` · ${sucursalNombre.toUpperCase()}` : ""}</div>
      </div>
      <div style={{ fontSize: 12, color: "#9ca3af", textAlign: "right" }}>Generado el {fechaLarga()}<br />{horaCorta()}</div>
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 16 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, maxHeight: "95vh" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, background: "var(--h421-white)", padding: 10, borderRadius: 12 }}>
          <button onClick={onCerrar} style={{ background: "var(--h421-gray-50)", padding: "10px 16px", fontSize: 13 }}>Cancelar</button>
          <button onClick={abrirCorreo} style={{ background: "var(--h421-blue)", color: "#fff", padding: "10px 16px", fontSize: 13 }}>✉️ Enviar por correo</button>
          <button onClick={exportarPdf} disabled={!!generando} style={{ background: "transparent", color: "inherit", border: "1px solid var(--h421-gray-400)", padding: "10px 16px", fontSize: 13 }}>{generando === "pdf" ? "Generando…" : "Exportar PDF"}</button>
          <button onClick={exportarExcel} disabled={!!generando} style={{ background: "transparent", color: "var(--h421-green)", border: "1px solid var(--h421-green)", padding: "10px 16px", fontSize: 13 }}>{generando === "excel" ? "Generando…" : "Exportar Excel"}</button>
          <button onClick={imprimir} style={{ background: "var(--h421-navy)", color: "#fff", padding: "10px 16px", fontSize: 13 }}>🖨️ Imprimir</button>
        </div>

        <div style={{ overflowY: "auto", overflowX: "auto", maxWidth: "100%", maxHeight: "calc(95vh - 70px)", perspective: 1600 }}>
          <div
            className={`h421-hoja-carta ${animacion}`}
            style={{
              width: "8.5in", minHeight: "11in", background: "#fff", color: "#111318", padding: "0.7in",
              boxShadow: "0 10px 40px rgba(0,0,0,0.35)", boxSizing: "border-box",
            }}
          >
            <Encabezado />

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "22px 0 0" }}>
              <div>
                <h1 style={{ margin: 0, fontSize: 24 }}>{titulo}</h1>
                <div style={{ width: 48, height: 3, background: "#0b1e33", marginTop: 6 }} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 13 }}>
                <button onClick={() => irA(paginaActual - 1, "hojeando-anterior")} disabled={paginaActual === 0 || !!animacion}
                  style={{ background: "none", color: paginaActual === 0 ? "#9ca3af" : "#0b1e33", padding: "6px 10px" }}>← Anterior</button>
                <span>Página {paginaActual + 1} de {totalPaginas}</span>
                <button onClick={() => irA(paginaActual + 1, "hojeando-siguiente")} disabled={paginaActual >= totalPaginas - 1 || !!animacion}
                  style={{ background: "#f6f7f8", color: "#111318", padding: "6px 10px", border: "1px solid #e5e7eb" }}>Siguiente →</button>
              </div>
            </div>

            <Semaforo />

            {filas.length === 0 ? (
              <p style={{ color: "#15803d", textAlign: "center", padding: "40px 0", fontWeight: 700 }}>
                No hay insumos en nivel bajo o crítico — todo el inventario está en verde.
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
                      <td style={{ padding: 10, fontWeight: 800, fontSize: 16, color: SEMAFORO[f.nivel].color, whiteSpace: "nowrap" }}>{f.existencia} <span style={{ fontSize: 11, fontWeight: 600 }}>{f.insumo.unidadMedida}</span></td>
                      <td style={{ padding: 10, color: "#6b7280" }}>{f.minimo} {f.insumo.unidadMedida}</td>
                      <td style={{ padding: 10 }}><Pildora nivel={f.nivel} /></td>
                      {tipo === "compras" && (
                        <>
                          <td style={{ padding: 10 }}>{f.insumo.proveedor?.nombre ?? "—"}</td>
                          <td style={{ padding: 10, fontWeight: 800, whiteSpace: "nowrap" }}>{calcularSugerido(f)} {f.insumo.unidadMedida}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {modalCorreo && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 70, padding: 16 }}>
          <div className="card" style={{ width: 480, maxWidth: "100%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>✉️ Enviar {titulo.toLowerCase()}</h2>
              <button onClick={() => setModalCorreo(false)} style={{ background: "none", fontSize: 20 }}>✕</button>
            </div>
            <p style={{ fontSize: 13, color: "var(--h421-gray-400)", margin: "0 0 10px" }}>
              Va el PDF adjunto y, en el cuerpo del correo, el semáforo ({resumen.critico} en rojo, {resumen.bajo} en amarillo, {resumen.optimo} en verde)
              {tipo === "compras" ? " con la cantidad a comprar de cada insumo." : " con los insumos por surtir."}
            </p>
            <label style={{ fontSize: 12, fontWeight: 700 }}>Para (uno o varios correos, separados por coma)</label>
            <input value={destinatarios} onChange={(e) => setDestinatarios(e.target.value)} placeholder="compras@tuempresa.com, gerente@tuempresa.com"
              inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false}
              style={{ width: "100%", padding: 10, margin: "4px 0 10px", borderRadius: 8, border: "1px solid var(--h421-gray-200)", fontSize: 16 }} />
            <label style={{ fontSize: 12, fontWeight: 700 }}>Mensaje (opcional)</label>
            <textarea value={mensajeCorreo} onChange={(e) => setMensajeCorreo(e.target.value)} rows={3} placeholder="Ej. Favor de surtir mañana temprano."
              style={{ width: "100%", padding: 10, margin: "4px 0 10px", borderRadius: 8, border: "1px solid var(--h421-gray-200)", fontSize: 14, resize: "vertical" }} />

            {estadoCorreo === null && <p style={{ fontSize: 13, color: "var(--h421-gray-400)" }}>Consultando el servidor de correo…</p>}
            {estadoCorreo && !estadoCorreo.configurado && (
              <div style={{ background: "var(--h421-amber-bg)", color: "var(--h421-amber-texto)", borderRadius: 8, padding: 10, fontSize: 13, marginBottom: 10 }}>
                <strong>El servidor aún no tiene correo configurado.</strong> {estadoCorreo.detalle}
                <br />Mientras tanto puedes abrir tu correo con el resumen listo y adjuntar el PDF que se descarga.
              </div>
            )}
            {resultadoCorreo && (
              <p style={{ fontSize: 13, fontWeight: 700, color: resultadoCorreo.ok ? "var(--h421-green)" : "var(--h421-red-texto)", margin: "0 0 10px" }}>{resultadoCorreo.texto}</p>
            )}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <button onClick={abrirCorreoManual} style={{ background: "transparent", color: "var(--h421-blue)", border: "1px solid var(--h421-blue)", padding: "10px 14px", fontSize: 13 }}>Abrir mi correo (PDF aparte)</button>
              <button onClick={enviarPorCorreo} disabled={enviando || !estadoCorreo?.configurado}
                style={{ background: estadoCorreo?.configurado ? "var(--h421-green)" : "var(--h421-gray-200)", color: estadoCorreo?.configurado ? "#fff" : "var(--h421-gray-400)", padding: "10px 16px", fontSize: 13 }}>
                {enviando ? "Enviando…" : "Enviar con PDF adjunto"}
              </button>
            </div>
            {estadoCorreo?.configurado && estadoCorreo.remitente && (
              <p style={{ fontSize: 11, color: "var(--h421-gray-400)", margin: "8px 0 0" }}>Se envía desde {estadoCorreo.remitente}.</p>
            )}
          </div>
        </div>
      )}

      {/* Versión completa (todas las filas, sin paginar) para @media print — la vista de arriba
          solo muestra una "página" a la vez y no debe ser lo que sale al imprimir. */}
      <div id="reporte-imprimible">
        <Encabezado />
        <h1 style={{ fontSize: 24, margin: "22px 0 0" }}>{titulo}</h1>
        <Semaforo />
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#0b1e33", color: "#fff", textAlign: "left" }}>
              {encabezados.map((h) => <th key={h} style={{ padding: 10 }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #e5e7eb" }}>
                {celdasTexto(tipo, f).map((c, j) => (
                  <td key={j} style={{ padding: 10, fontWeight: j === 1 || j === CONFIG[tipo].columnaEstado ? 800 : 400, color: j === 1 || j === CONFIG[tipo].columnaEstado ? SEMAFORO[f.nivel].color : undefined }}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
