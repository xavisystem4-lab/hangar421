"use client";

import { useEffect, useState } from "react";
import { csvConsumosCredito, describirProductoConsumido, type ConsumoPorEmpleada } from "@hangar421/shared";
import { apiFetch } from "@/lib/api";
import { StatTile } from "@/components/StatTile";

const ZONA = "America/Mexico_City";
const fmtFecha = (iso: string) => new Date(iso).toLocaleDateString("es-MX", { timeZone: ZONA, weekday: "short", day: "2-digit", month: "short", year: "numeric" });
const fmtHora = (iso: string) => new Date(iso).toLocaleTimeString("es-MX", { timeZone: ZONA, hour: "2-digit", minute: "2-digit" });
const fmtFechaHora = (iso: string) => `${fmtFecha(iso)} ${fmtHora(iso)}`;

/**
 * Reportes → Crédito de empleados: qué consumió cada empleada con su crédito, con fecha, hora,
 * folio y los productos (con sus modificadores). Mismo agrupado que la tablet
 * (agruparConsumosPorEmpleada en shared).
 */
export function ReporteCreditoEmpleados({ sucursalId, desde, hasta }: { sucursalId: string; desde: string; hasta: string }) {
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

  function exportar() {
    const csv = csvConsumosCredito(grupos, fmtFechaHora);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `credito-empleados_${desde}_a_${hasta}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "stretch" }}>
        <StatTile etiqueta="Consumido a crédito" valor={`$${total.toFixed(2)}`} acento="var(--h421-amber)" />
        <StatTile etiqueta="Consumos" valor={String(consumos)} acento="var(--h421-blue)" />
        <StatTile etiqueta="Empleadas" valor={String(grupos.length)} acento="var(--h421-green)" />
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: "auto" }}>
          <button onClick={exportar} disabled={grupos.length === 0} style={{ background: "var(--h421-green-bg)", color: "var(--h421-green)", border: "1px solid var(--h421-green)", padding: "10px 14px", fontSize: 13 }}>⬇ Excel (CSV)</button>
          <button onClick={() => window.print()} disabled={grupos.length === 0} style={{ background: "transparent", border: "1px solid var(--h421-gray-200)", padding: "10px 14px", fontSize: 13 }}>🖨 Imprimir</button>
        </div>
      </div>

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
                    {g.consumos.map((c) => (
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
