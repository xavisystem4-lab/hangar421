"use client";

import { Fragment, useEffect, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { describirProductoConsumido, filasDetalleCredito, filasResumenCredito, semanasDeCredito, type ConsumoPorEmpleada } from "@hangar421/shared";
import { apiFetch } from "@/lib/api";
import { StatTile } from "@/components/StatTile";
import { guardarConDialogoWeb } from "@/components/ReporteInventario";

const ZONA = "America/Mexico_City";
const fmtFecha = (iso: string) => new Date(iso).toLocaleDateString("es-MX", { timeZone: ZONA, weekday: "short", day: "2-digit", month: "short", year: "numeric" });
const fmtHora = (iso: string) => new Date(iso).toLocaleTimeString("es-MX", { timeZone: ZONA, hour: "2-digit", minute: "2-digit" });
const fmtFechaHora = (iso: string) => `${fmtFecha(iso)} ${fmtHora(iso)}`;

/**
 * Reportes → Crédito de empleados: qué consumió cada empleada con su crédito, con fecha, hora,
 * folio y los productos (con sus modificadores). Mismo agrupado que la tablet
 * (agruparConsumosPorEmpleada en shared).
 */
const CLAVE_DESTINATARIOS = "hangar421_credito_destinatarios";

/** Regla de la empleada (la manda el ERP con el reporte) para separar por semana de crédito. */
type ReglaCredito = { limite: number; diaReinicio: number; horaReinicio: number; minutoReinicio: number } | null;
const fmtCorte = (d: Date) => d.toLocaleString("es-MX", { weekday: "short", day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" });

/** Periodo legible: "12/10/2026" o "06/10/2026 al 12/10/2026". */
function periodoTexto(desde: string, hasta: string): string {
  const f = (d: string) => d.split("-").reverse().join("/");
  return desde === hasta ? f(desde) : `${f(desde)} al ${f(hasta)}`;
}

function construirPdf(grupos: ConsumoPorEmpleada[], periodo: string, sucursal: string): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const total = grupos.reduce((s, g) => s + g.totalCredito, 0);
  doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.setTextColor(11, 30, 51);
  doc.text("HANGAR 421 · Crédito de empleados", 40, 50);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(107, 114, 128);
  doc.text(`${sucursal} · ${periodo}`, 40, 68);
  doc.setFontSize(12); doc.setTextColor(17, 19, 24);
  doc.text(`Total consumido a crédito: $${total.toFixed(2)} · ${grupos.length} empleada(s)`, 40, 92);
  autoTable(doc, {
    startY: 104,
    head: [["Empleada", "Consumos", "Productos", "Total"]],
    body: grupos.map((g) => [g.empleado, String(g.numConsumos), String(g.numProductos), `$${g.totalCredito.toFixed(2)}`]),
    headStyles: { fillColor: [11, 30, 51] }, styles: { fontSize: 10 }, margin: { left: 40, right: 40 },
  });
  for (const g of grupos) {
    const y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 120) + 24;
    doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(11, 30, 51);
    doc.text(`${g.empleado} · $${g.totalCredito.toFixed(2)}`, 40, y);
    autoTable(doc, {
      startY: y + 8,
      head: [["Día y fecha", "Hora", "Folio", "Productos", "A crédito"]],
      body: g.consumos.map((c) => [fmtFecha(c.fecha), fmtHora(c.fecha), c.folio ? `#${c.folio}` : "—", c.productos.map((p) => `${p.cantidad} × ${describirProductoConsumido(p)}`).join("\n") || "(sin detalle)", `$${c.montoCredito.toFixed(2)}`]),
      headStyles: { fillColor: [180, 83, 9] }, styles: { fontSize: 9, cellPadding: 4 }, columnStyles: { 4: { halign: "right", fontStyle: "bold" } },
      margin: { left: 40, right: 40 },
    });
  }
  return doc;
}

function construirExcelBase64(grupos: ConsumoPorEmpleada[]): string {
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(filasResumenCredito(grupos)), "Resumen");
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(filasDetalleCredito(grupos, fmtFechaHora)), "Detalle");
  return XLSX.write(libro, { bookType: "xlsx", type: "base64" }) as string;
}

const base64ABlob = (b64: string, tipo: string) => new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: tipo });
const TIPO_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function ReporteCreditoEmpleados({ sucursalId, sucursalNombre, desde, hasta }: { sucursalId: string; sucursalNombre?: string; desde: string; hasta: string }) {
  const [grupos, setGrupos] = useState<ConsumoPorEmpleada[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!sucursalId) return;
    setCargando(true);
    setError(null);
    const rangoDesde = new Date(`${desde}T00:00:00`).toISOString();
    const rangoHasta = new Date(`${hasta}T23:59:59`).toISOString();
    apiFetch<ConsumoPorEmpleada[]>(`/monedero/consumos?sucursalId=${sucursalId}&desde=${rangoDesde}&hasta=${rangoHasta}`)
      .then((g) => { setGrupos(g); setAbiertas(new Set(g.slice(0, 1).map((x) => x.empleadoId))); })
      .catch((e) => setError(e?.message ?? "No se pudo cargar el reporte."))
      .finally(() => setCargando(false));
  }, [sucursalId, desde, hasta]);

  const total = grupos.reduce((s, g) => s + g.totalCredito, 0);
  const consumos = grupos.reduce((s, g) => s + g.numConsumos, 0);

  function alternar(id: string) {
    setAbiertas((a) => {
      const n = new Set(a);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  const periodo = periodoTexto(desde, hasta);
  const archivoBase = `credito-empleados_${desde}_a_${hasta}`;
  const [modalCorreo, setModalCorreo] = useState(false);
  const [destinatarios, setDestinatarios] = useState(() => { try { return localStorage.getItem(CLAVE_DESTINATARIOS) ?? ""; } catch { return ""; } });
  const [mensajeCorreo, setMensajeCorreo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [resultadoCorreo, setResultadoCorreo] = useState<{ ok: boolean; texto: string } | null>(null);

  async function exportarPdf() {
    const doc = construirPdf(grupos, periodo, sucursalNombre ?? "");
    await guardarConDialogoWeb(doc.output("blob"), `${archivoBase}.pdf`, [{ description: "Documento PDF", accept: { "application/pdf": [".pdf"] } }]);
  }

  async function exportarExcel() {
    await guardarConDialogoWeb(base64ABlob(construirExcelBase64(grupos), TIPO_XLSX), `${archivoBase}.xlsx`, [{ description: "Libro de Excel", accept: { [TIPO_XLSX]: [".xlsx"] } }]);
  }

  async function enviarPorCorreo() {
    if (!destinatarios.trim()) { setResultadoCorreo({ ok: false, texto: "Captura al menos un correo." }); return; }
    setEnviando(true);
    setResultadoCorreo(null);
    try {
      const pdfBase64 = construirPdf(grupos, periodo, sucursalNombre ?? "").output("datauristring").split(",")[1];
      const r = await apiFetch<{ enviadoA: string[] }>("/monedero/consumos/enviar", {
        method: "POST",
        body: JSON.stringify({
          sucursalId, periodo, destinatarios, mensaje: mensajeCorreo.trim() || undefined,
          desde: new Date(`${desde}T00:00:00`).toISOString(), hasta: new Date(`${hasta}T23:59:59`).toISOString(),
          pdfBase64, excelBase64: construirExcelBase64(grupos),
        }),
      });
      try { localStorage.setItem(CLAVE_DESTINATARIOS, destinatarios.trim()); } catch { /* sin almacenamiento */ }
      setResultadoCorreo({ ok: true, texto: `Enviado a ${r.enviadoA.join(", ")}.` });
    } catch (e) {
      setResultadoCorreo({ ok: false, texto: (e as Error)?.message || "No se pudo enviar el correo." });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "stretch" }}>
        <StatTile etiqueta="Consumido a crédito" valor={`$${total.toFixed(2)}`} acento="var(--h421-amber)" />
        <StatTile etiqueta="Consumos" valor={String(consumos)} acento="var(--h421-blue)" />
        <StatTile etiqueta="Empleadas" valor={String(grupos.length)} acento="var(--h421-green)" />
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: "auto" }}>
          <button onClick={exportarPdf} disabled={grupos.length === 0} style={{ background: "transparent", border: "1px solid var(--h421-gray-400)", padding: "10px 14px", fontSize: 13 }}>📄 PDF</button>
          <button onClick={exportarExcel} disabled={grupos.length === 0} style={{ background: "var(--h421-green-bg)", color: "var(--h421-green)", border: "1px solid var(--h421-green)", padding: "10px 14px", fontSize: 13 }}>📊 Excel</button>
          <button onClick={() => { setResultadoCorreo(null); setModalCorreo(true); }} disabled={grupos.length === 0} style={{ background: "var(--h421-blue)", color: "#fff", padding: "10px 14px", fontSize: 13 }}>✉ Correo</button>
          <button onClick={() => window.print()} disabled={grupos.length === 0} style={{ background: "transparent", border: "1px solid var(--h421-gray-200)", padding: "10px 14px", fontSize: 13 }}>🖨 Imprimir</button>
        </div>
      </div>

      {modalCorreo && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}>
          <div className="card" style={{ width: 460, maxWidth: "100%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>Enviar por correo</h3>
              <button onClick={() => setModalCorreo(false)} style={{ background: "none", fontSize: 20 }}>✕</button>
            </div>
            <p style={{ fontSize: 13, color: "var(--h421-gray-500)" }}>Crédito de empleados · {periodo}. Van adjuntos el PDF y el Excel.</p>
            <input value={destinatarios} onChange={(e) => setDestinatarios(e.target.value)} placeholder="correo@ejemplo.com, otro@ejemplo.com"
              style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--h421-gray-200)", marginBottom: 8 }} />
            <textarea value={mensajeCorreo} onChange={(e) => setMensajeCorreo(e.target.value)} placeholder="Mensaje (opcional)" rows={3}
              style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
            {resultadoCorreo && <p style={{ color: resultadoCorreo.ok ? "var(--h421-green)" : "var(--h421-red)", fontSize: 13 }}>{resultadoCorreo.texto}</p>}
            <button onClick={enviarPorCorreo} disabled={enviando} style={{ width: "100%", marginTop: 8, background: "var(--h421-blue)", color: "#fff", padding: "10px 16px" }}>
              {enviando ? "Enviando…" : "Enviar"}
            </button>
          </div>
        </div>
      )}

      {cargando && <p style={{ color: "var(--h421-gray-400)" }}>Cargando…</p>}
      {error && <p style={{ color: "var(--h421-red)" }}>{error}</p>}
      {!cargando && !error && grupos.length === 0 && (
        <div className="card" style={{ marginTop: 16, color: "var(--h421-gray-400)" }}>Nadie usó crédito de empleado en estas fechas.</div>
      )}

      {grupos.map((g) => {
        const abierta = abiertas.has(g.empleadoId);
        return (
          <div key={g.empleadoId} className="card" style={{ marginTop: 14, borderLeft: "4px solid var(--h421-amber)" }}>
            <button onClick={() => alternar(g.empleadoId)}
              style={{ display: "flex", width: "100%", alignItems: "center", gap: 12, background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
              <span style={{ fontSize: 18 }}>{abierta ? "▾" : "▸"}</span>
              <span style={{ fontWeight: 800, fontSize: 16, flex: 1 }}>{g.empleado}</span>
              <span style={{ fontSize: 13, color: "var(--h421-gray-500)" }}>{g.numConsumos} consumo(s) · {g.numProductos} producto(s)</span>
              <span style={{ fontWeight: 800, fontSize: 18, color: "var(--h421-amber-texto)" }}>${g.totalCredito.toFixed(2)}</span>
            </button>

            {abierta && (
              <div className="h421-tabla-wrap" style={{ overflowX: "auto", marginTop: 10 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: "var(--h421-gray-500)", borderBottom: "1px solid var(--h421-gray-200)" }}>
                      <th style={{ padding: 6 }}>Día y fecha</th>
                      <th style={{ padding: 6 }}>Hora</th>
                      <th style={{ padding: 6 }}>Folio</th>
                      <th style={{ padding: 6 }}>Productos</th>
                      <th style={{ padding: 6, textAlign: "right" }}>A crédito</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const regla = (g as ConsumoPorEmpleada & { regla?: ReglaCredito }).regla ?? null;
                      // Sin regla (ERP anterior): una sola lista, como antes.
                      const semanas = regla
                        ? semanasDeCredito(g.consumos, { diaSemana: regla.diaReinicio, hora: regla.horaReinicio, minuto: regla.minutoReinicio })
                        : [{ inicio: null as Date | null, fin: null as Date | null, total: g.totalCredito, consumos: g.consumos }];
                      return semanas.map((sem, i) => (
                        <Fragment key={i}>
                          {regla && sem.inicio && sem.fin && (
                            <tr style={{ background: "var(--h421-gray-50, #f8fafc)" }}>
                              <td colSpan={4} style={{ padding: "6px 6px", fontWeight: 700, fontSize: 12 }}>
                                Semana de crédito: {fmtCorte(sem.inicio)} → {fmtCorte(sem.fin)}
                              </td>
                              <td style={{ padding: 6, textAlign: "right", fontWeight: 800, fontSize: 12, color: sem.total > regla.limite ? "var(--h421-red)" : "var(--h421-green)" }}>
                                ${sem.total.toFixed(2)} de ${regla.limite.toFixed(0)}
                              </td>
                            </tr>
                          )}
                          {sem.consumos.map((c) => (
                      <tr key={c.ventaId} style={{ borderBottom: "1px solid var(--h421-gray-100, #f1f5f9)", verticalAlign: "top" }}>
                        <td style={{ padding: 6, whiteSpace: "nowrap" }}>{fmtFecha(c.fecha)}</td>
                        <td style={{ padding: 6, whiteSpace: "nowrap" }}>{fmtHora(c.fecha)}</td>
                        <td style={{ padding: 6 }}>{c.folio ? `#${c.folio}` : "—"}</td>
                        <td style={{ padding: 6 }}>
                          {c.productos.length === 0 ? <span style={{ color: "var(--h421-gray-400)" }}>(sin detalle)</span> : c.productos.map((p, i) => (
                            <div key={i}>{p.cantidad} × {describirProductoConsumido(p)}</div>
                          ))}
                          {c.montoCredito < c.totalVenta && (
                            <div style={{ fontSize: 11, color: "var(--h421-gray-400)" }}>Venta de ${c.totalVenta.toFixed(2)}; el resto se pagó con otro método.</div>
                          )}
                        </td>
                        <td style={{ padding: 6, textAlign: "right", fontWeight: 700 }}>${c.montoCredito.toFixed(2)}</td>
                      </tr>
                          ))}
                        </Fragment>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
