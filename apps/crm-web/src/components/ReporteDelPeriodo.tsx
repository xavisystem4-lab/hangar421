"use client";

import { useEffect, useMemo, useState } from "react";
import { armarReportePeriodo, etiquetaHora, type GrupoReporte, type ReportePeriodo } from "@hangar421/shared";
import { apiFetch } from "@/lib/api";
import { StatTile } from "@/components/StatTile";
import { BotonesExportar } from "@/components/BotonesExportar";
import { exportarReportePeriodoExcel, exportarReportePeriodoPdf } from "@/lib/exportarVentas";

/**
 * Reportes → 📅 Quién vende más: ventas del periodo (un mes, normalmente) por cafetería, por
 * empleado, por turno, por día de la semana, por hora y por fecha. Lee los tickets del módulo
 * Ventas (mismos filtros, sin cancelados) y los agrupa con armarReportePeriodo de
 * @hangar421/shared, la misma función que usa la tablet.
 */

interface VentaApi {
  fecha: string;
  estado: string;
  total: number;
  sucursal: { nombre: string } | null;
  cajero: { nombre: string } | null;
  mesero: { nombre: string } | null;
  turno: { fechaApertura: string } | null;
}
interface RespuestaVentas {
  rango: { zona: string };
  paginacion: { total: number };
  items: VentaApi[];
}

const TOPE = 20_000;
const dinero = (n: number) => `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fechaCorta = (f: string) => new Date(`${f}T12:00:00`).toLocaleDateString("es-MX", { weekday: "short", day: "2-digit", month: "short" });

function fechaISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/** Primer y último día del mes de `d` (+ `desplazamiento` meses). */
function mes(d: Date, desplazamiento = 0): [string, string] {
  const ini = new Date(d.getFullYear(), d.getMonth() + desplazamiento, 1);
  const fin = new Date(d.getFullYear(), d.getMonth() + desplazamiento + 1, 0);
  return [fechaISO(ini), fechaISO(fin)];
}

export function ReporteDelPeriodo({
  sucursalId,
  sucursalNombre,
  desde,
  hasta,
  onRango,
}: {
  sucursalId?: string;
  sucursalNombre?: string;
  desde: string;
  hasta: string;
  onRango: (desde: string, hasta: string) => void;
}) {
  const [reporte, setReporte] = useState<ReportePeriodo | null>(null);
  const [zona, setZona] = useState("America/Mexico_City");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    (async () => {
      setCargando(true);
      setError(null);
      try {
        const base = new URLSearchParams({ desde, hasta, limite: "200" });
        if (sucursalId) base.set("sucursalId", sucursalId);
        const ventas: VentaApi[] = [];
        let zonaRango = "America/Mexico_City";
        for (let offset = 0; offset < TOPE; offset += 200) {
          base.set("offset", String(offset));
          const r = await apiFetch<RespuestaVentas>(`/pedidos/ventas?${base}`);
          zonaRango = r.rango?.zona ?? zonaRango;
          ventas.push(...r.items);
          if (r.items.length === 0 || ventas.length >= r.paginacion.total) break;
        }
        if (!vigente) return;
        setZona(zonaRango);
        setReporte(
          armarReportePeriodo(
            ventas
              .filter((v) => v.estado !== "CANCELADO")
              .map((v) => ({
                fecha: v.fecha,
                total: v.total,
                sucursal: v.sucursal?.nombre ?? "",
                empleado: v.cajero?.nombre ?? v.mesero?.nombre ?? "",
                turnoApertura: v.turno?.fechaApertura ?? null,
              })),
            zonaRango,
          ),
        );
      } catch (e: any) {
        if (vigente) setError(e?.message ?? "No se pudo cargar el reporte.");
      } finally {
        if (vigente) setCargando(false);
      }
    })();
    return () => {
      vigente = false;
    };
  }, [sucursalId, desde, hasta]);

  const hoy = useMemo(() => new Date(), []);
  const [mesActualDesde, mesActualHasta] = mes(hoy);
  const [mesPasadoDesde, mesPasadoHasta] = mes(hoy, -1);
  const datosExport = reporte ? { reporte, sucursal: sucursalNombre ?? "Todas las cafeterías", desde, hasta } : null;

  return (
    <div style={{ marginTop: 12 }}>
      <div className="card" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>Periodo:</span>
        <BotonRango activo={desde === mesActualDesde && hasta === mesActualHasta} onClick={() => onRango(mesActualDesde, mesActualHasta)}>Este mes</BotonRango>
        <BotonRango activo={desde === mesPasadoDesde && hasta === mesPasadoHasta} onClick={() => onRango(mesPasadoDesde, mesPasadoHasta)}>Mes pasado</BotonRango>
        <label style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}>
          Mes:
          <input
            type="month"
            value={desde.slice(0, 7)}
            onChange={(e) => {
              if (!e.target.value) return;
              const [a, m] = e.target.value.split("-").map(Number);
              onRango(...mes(new Date(a, m - 1, 1)));
            }}
            style={{ padding: 6 }}
          />
        </label>
        <span style={{ fontSize: 12, color: "var(--h421-gray-400)" }}>
          {sucursalNombre ? `Solo ${sucursalNombre}` : "Todas las cafeterías"} · horas en {zona.replace("America/", "").replace("_", " ")}
        </span>
        <div style={{ marginLeft: "auto" }}>
          <BotonesExportar
            deshabilitado={!datosExport || cargando}
            onPdf={() => exportarReportePeriodoPdf(datosExport!)}
            onExcel={() => exportarReportePeriodoExcel(datosExport!)}
          />
        </div>
      </div>

      {cargando && <p style={{ color: "var(--h421-gray-400)" }}>Cargando las ventas del periodo…</p>}
      {error && <p style={{ color: "var(--h421-red)" }}>{error}</p>}

      {reporte && !cargando && (
        <>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <StatTile etiqueta="Vendido" valor={dinero(reporte.total)} acento="var(--h421-green)" />
            <StatTile etiqueta="Tickets" valor={reporte.tickets.toLocaleString("es-MX")} acento="var(--h421-blue)" />
            <StatTile etiqueta="Ticket promedio" valor={dinero(reporte.ticketPromedio)} acento="var(--h421-amber)" />
          </div>

          {reporte.tickets === 0 ? (
            <div className="card" style={{ marginTop: 16, color: "var(--h421-gray-400)" }}>No hay ventas en este periodo.</div>
          ) : (
            <>
              <h3 style={{ marginBottom: 8 }}>🏆 Lo que más vende</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
                <Mejor titulo="Cafetería" g={reporte.mejor.sucursal} nombre={(g) => g.clave} />
                <Mejor titulo="Empleado" g={reporte.mejor.empleado} nombre={(g) => `${g.empleado} (${g.sucursal})`} />
                <Mejor titulo="Turno" g={reporte.mejor.turno} nombre={(g) => `${g.turno} · ${g.sucursal}`} />
                <Mejor titulo="Día de la semana" g={reporte.mejor.diaSemana} nombre={(g) => g.clave} />
                <Mejor titulo="Hora" g={reporte.mejor.hora} nombre={(g) => etiquetaHora(g.hora)} />
                <Mejor titulo="Mejor día" g={reporte.mejor.fecha} nombre={(g) => fechaCorta(g.fecha)} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 16, marginTop: 16 }}>
                <Tabla titulo="Por cafetería" filas={reporte.porSucursal.map((g) => ({ ...g, etiqueta: g.clave }))} />
                <Tabla titulo="Por empleado" filas={reporte.porEmpleado.map((g) => ({ ...g, etiqueta: g.empleado, detalle: g.sucursal }))} />
                <Tabla titulo="Por turno" filas={reporte.porTurno.map((g) => ({ ...g, etiqueta: `Turno ${g.turno === "Sin turno" ? "— sin turno" : `de la ${g.turno.toLowerCase()}`}`, detalle: g.sucursal }))} nota="Mañana = turnos que abren antes de las 12:00." />
                <Tabla titulo="Por día de la semana" filas={reporte.porDiaSemana.map((g) => ({ ...g, etiqueta: g.clave }))} ordenFijo />
                <Tabla titulo="Por hora" filas={reporte.porHora.map((g) => ({ ...g, etiqueta: etiquetaHora(g.hora) }))} ordenFijo />
                <Tabla titulo="Por fecha" filas={reporte.porFecha.map((g) => ({ ...g, etiqueta: fechaCorta(g.fecha) }))} ordenFijo />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function BotonRango({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "7px 12px", fontSize: 13, fontWeight: 700, borderRadius: 999,
        background: activo ? "var(--h421-navy)" : "transparent", color: activo ? "#fff" : "var(--h421-navy-texto)",
        border: `1px solid ${activo ? "var(--h421-navy)" : "var(--h421-gray-200)"}`,
      }}
    >
      {children}
    </button>
  );
}

function Mejor<T extends GrupoReporte>({ titulo, g, nombre }: { titulo: string; g: T | null; nombre: (g: T) => string }) {
  return (
    <div className="card" style={{ borderTop: "4px solid var(--h421-amber)" }}>
      <div style={{ fontSize: 12, color: "var(--h421-gray-400)", fontWeight: 700 }}>{titulo}</div>
      <div style={{ fontSize: 17, fontWeight: 800, marginTop: 4 }}>{g ? nombre(g) : "—"}</div>
      {g && (
        <div style={{ fontSize: 12, color: "var(--h421-gray-400)", marginTop: 2 }}>
          {dinero(g.total)} · {g.tickets} tickets · {g.porcentaje}%
        </div>
      )}
    </div>
  );
}

function Tabla({ titulo, filas, nota, ordenFijo }: { titulo: string; filas: (GrupoReporte & { etiqueta: string; detalle?: string })[]; nota?: string; ordenFijo?: boolean }) {
  const max = Math.max(1, ...filas.map((f) => f.total));
  const mejor = ordenFijo ? Math.max(...filas.map((f) => f.total)) : null;
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{titulo}</h3>
      {nota && <p style={{ fontSize: 12, color: "var(--h421-gray-400)", marginTop: -6 }}>{nota}</p>}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ color: "var(--h421-gray-400)", textAlign: "left" }}>
            <th style={{ padding: "4px 6px" }}></th>
            <th style={{ padding: "4px 6px", textAlign: "right" }}>Tickets</th>
            <th style={{ padding: "4px 6px", textAlign: "right" }}>Vendido</th>
            <th style={{ padding: "4px 6px", textAlign: "right" }}>Promedio</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.clave} style={{ borderTop: "1px solid var(--h421-gray-200)" }}>
              <td style={{ padding: "6px", width: "45%" }}>
                <div style={{ fontWeight: 700 }}>
                  {f.etiqueta}
                  {mejor != null && f.total === mejor && f.total > 0 ? " 🏆" : ""}
                </div>
                {f.detalle && <div style={{ fontSize: 11, color: "var(--h421-gray-400)" }}>{f.detalle}</div>}
                <div style={{ height: 6, borderRadius: 3, background: "var(--h421-gray-200)", marginTop: 4 }}>
                  <div style={{ width: `${(f.total / max) * 100}%`, height: "100%", borderRadius: 3, background: "var(--h421-amber)" }} />
                </div>
              </td>
              <td style={{ padding: "6px", textAlign: "right" }}>{f.tickets}</td>
              <td style={{ padding: "6px", textAlign: "right", fontWeight: 700 }}>
                {dinero(f.total)}
                <div style={{ fontSize: 11, color: "var(--h421-gray-400)", fontWeight: 400 }}>{f.porcentaje}%</div>
              </td>
              <td style={{ padding: "6px", textAlign: "right" }}>{dinero(f.ticketPromedio)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
