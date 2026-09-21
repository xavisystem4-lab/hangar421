"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuthCrm } from "@/lib/authClient";
import { useSucursalActiva } from "@/store/sucursalActiva";
import { StatTile } from "@/components/StatTile";

interface Turno {
  id: string;
  estado: "ABIERTO" | "CERRADO";
  fechaApertura: string;
  fechaCierre: string | null;
  sucursal: { id: string; nombre: string };
  caja: { id: string; nombre: string };
  usuario: { id: string; nombre: string };
  montoInicial: number;
  montoFinalDeclarado: number | null;
  montoFinalSistema: number | null;
  diferencia: number | null;
  pendienteDiaAnterior: boolean;
  ventas?: { numTickets: number; total: number };
}

interface RespuestaTurnos {
  items: Turno[];
  /** Turnos abiertos desde un día anterior, sin importar los filtros de la tabla. */
  pendientes: Turno[];
}

function diaLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function haceDias(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return diaLocal(d);
}

const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString("es-MX", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Enlace a Ventas filtrado por el turno, con el rango de fechas que lo cubre (Ventas siempre
 *  filtra por rango, y un turno puede cruzar la medianoche). */
function enlaceVentas(t: Turno): string {
  const desde = diaLocal(new Date(t.fechaApertura));
  const hasta = diaLocal(t.fechaCierre ? new Date(t.fechaCierre) : new Date());
  return `/ventas?turnoId=${t.id}&desde=${desde}&hasta=${hasta}`;
}

/**
 * Turnos y cortes de caja: abiertos y cerrados, con responsable, lo vendido y el resultado del
 * corte. Arriba, siempre visibles, los turnos que siguen abiertos desde un día anterior — un
 * turno que nadie cerró deja las ventas del día siguiente mezcladas en el mismo corte.
 */
export default function TurnosPage() {
  const { contexto } = useAuthCrm();
  const { seleccion } = useSucursalActiva();

  const [desde, setDesde] = useState(haceDias(7));
  const [hasta, setHasta] = useState(diaLocal(new Date()));
  const [estado, setEstado] = useState("");
  const [datos, setDatos] = useState<RespuestaTurnos | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!contexto) return;
    setCargando(true);
    setError(null);
    try {
      const params = new URLSearchParams({ desde, hasta });
      if (seleccion?.sucursalId) params.set("sucursalId", seleccion.sucursalId);
      if (estado) params.set("estado", estado);
      setDatos(await apiFetch<RespuestaTurnos>(`/caja/turnos?${params}`));
    } catch (e: any) {
      setError(e?.message ?? "No se pudieron cargar los turnos");
    } finally {
      setCargando(false);
    }
  }, [contexto, seleccion?.sucursalId, desde, hasta, estado]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const cerrados = datos?.items.filter((t) => t.estado === "CERRADO") ?? [];
  const sumaDiferencias = cerrados.reduce((s, t) => s + (t.diferencia ?? 0), 0);
  const consolidado = !seleccion?.sucursalId;

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Turnos y cortes</h1>
      <p style={{ color: "var(--h421-gray-400)", marginTop: -8 }}>
        Turnos de caja de {seleccion?.nombre ?? "todas las sucursales"}. Un turno se cierra desde la terminal donde se
        abrió, con el conteo de efectivo.
      </p>

      {datos && datos.pendientes.length > 0 && (
        <div className="card" style={{ borderLeft: "4px solid var(--h421-red)" }}>
          <strong>
            {datos.pendientes.length === 1 ? "Hay un turno" : `Hay ${datos.pendientes.length} turnos`} sin cerrar desde un día anterior
          </strong>
          <p style={{ margin: "6px 0 10px", fontSize: 14 }}>
            Mientras siga abierto, las ventas nuevas se suman a ese mismo corte. Pide al responsable que lo cierre desde
            su terminal.
          </p>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th style={celdaEncabezado}>Sucursal</th>
                <th style={celdaEncabezado}>Abierto desde</th>
                <th style={celdaEncabezado}>Responsable</th>
                <th style={celdaEncabezado}>Turno</th>
              </tr>
            </thead>
            <tbody>
              {datos.pendientes.map((t) => (
                <tr key={t.id} style={{ borderTop: "1px solid var(--h421-gray-200)" }}>
                  <td style={celda}>{t.sucursal.nombre}</td>
                  <td style={celda}>{fechaHora(t.fechaApertura)}</td>
                  <td style={celda}>{t.usuario.nombre}</td>
                  <td style={celda}>
                    {t.caja.nombre} · <a href={enlaceVentas(t)}>ver ventas</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginTop: 16 }}>
        <label style={campo}>
          <span style={etiqueta}>Abiertos desde</span>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} style={entrada} />
        </label>
        <label style={campo}>
          <span style={etiqueta}>Hasta</span>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} style={entrada} />
        </label>
        <label style={campo}>
          <span style={etiqueta}>Estado de cierre</span>
          <select value={estado} onChange={(e) => setEstado(e.target.value)} style={entrada}>
            <option value="">Todos</option>
            <option value="ABIERTO">Abiertos</option>
            <option value="CERRADO">Cerrados</option>
          </select>
        </label>
        <button onClick={cargar} disabled={cargando} style={{ padding: "10px 18px", background: "var(--h421-navy)", color: "#fff" }}>
          {cargando ? "Cargando…" : "Actualizar"}
        </button>
      </div>

      {error && <p style={{ color: "var(--h421-red)" }}>{error}</p>}

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 16 }}>
        <StatTile etiqueta="Turnos" valor={String(datos?.items.length ?? 0)} acento="var(--h421-blue)" />
        <StatTile etiqueta="Abiertos" valor={String((datos?.items.length ?? 0) - cerrados.length)} acento="var(--h421-amber)" />
        <StatTile
          etiqueta="Diferencia acumulada en cortes"
          valor={`${sumaDiferencias < 0 ? "−" : ""}$${Math.abs(sumaDiferencias).toFixed(2)}`}
          acento={Math.abs(sumaDiferencias) < 0.01 ? "var(--h421-green)" : "var(--h421-red)"}
        />
      </div>

      <div className="card h421-tabla-wrap" style={{ marginTop: 16, overflowX: "auto" }}>
        {!datos ? (
          <p>Cargando…</p>
        ) : datos.items.length === 0 ? (
          <p style={{ margin: 0, color: "var(--h421-gray-400)" }}>No hay turnos en este rango.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--h421-gray-200)" }}>
                {consolidado && <th style={celdaEncabezado}>Sucursal</th>}
                <th style={celdaEncabezado}>Caja</th>
                <th style={celdaEncabezado}>Responsable</th>
                <th style={celdaEncabezado}>Apertura</th>
                <th style={celdaEncabezado}>Cierre</th>
                <th style={{ ...celdaEncabezado, textAlign: "right" }}>Ventas</th>
                <th style={{ ...celdaEncabezado, textAlign: "right" }}>Fondo</th>
                <th style={{ ...celdaEncabezado, textAlign: "right" }}>Esperado</th>
                <th style={{ ...celdaEncabezado, textAlign: "right" }}>Declarado</th>
                <th style={{ ...celdaEncabezado, textAlign: "right" }}>Diferencia</th>
                <th style={celdaEncabezado}></th>
              </tr>
            </thead>
            <tbody>
              {datos.items.map((t) => (
                <tr key={t.id} style={{ borderBottom: "1px solid var(--h421-gray-200)" }}>
                  {consolidado && <td style={celda}>{t.sucursal.nombre}</td>}
                  <td style={celda}>{t.caja.nombre}</td>
                  <td style={celda}>{t.usuario.nombre}</td>
                  <td style={celda}>{fechaHora(t.fechaApertura)}</td>
                  <td style={celda}>
                    {t.fechaCierre ? (
                      fechaHora(t.fechaCierre)
                    ) : (
                      <span style={{ color: t.pendienteDiaAnterior ? "var(--h421-red)" : "var(--h421-amber)", fontWeight: 700 }}>
                        {t.pendienteDiaAnterior ? "Abierto (día anterior)" : "Abierto"}
                      </span>
                    )}
                  </td>
                  <td style={{ ...celda, textAlign: "right" }}>
                    {t.ventas?.numTickets ?? 0} · ${(t.ventas?.total ?? 0).toFixed(2)}
                  </td>
                  <td style={{ ...celda, textAlign: "right" }}>${t.montoInicial.toFixed(2)}</td>
                  <td style={{ ...celda, textAlign: "right" }}>{dinero(t.montoFinalSistema)}</td>
                  <td style={{ ...celda, textAlign: "right" }}>{dinero(t.montoFinalDeclarado)}</td>
                  <td
                    style={{
                      ...celda,
                      textAlign: "right",
                      fontWeight: 700,
                      color: t.diferencia == null || Math.abs(t.diferencia) < 0.01 ? undefined : "var(--h421-red)",
                    }}
                  >
                    {dinero(t.diferencia)}
                  </td>
                  <td style={celda}>
                    <a href={enlaceVentas(t)}>Ventas</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function dinero(n: number | null): string {
  if (n == null) return "—";
  return `${n < 0 ? "−" : ""}$${Math.abs(n).toFixed(2)}`;
}

const campo: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4 };
const etiqueta: React.CSSProperties = { fontSize: 12, color: "var(--h421-gray-400)", fontWeight: 700 };
const entrada: React.CSSProperties = { padding: "9px 10px", borderRadius: 8, border: "1px solid var(--h421-gray-200)" };
const celdaEncabezado: React.CSSProperties = { padding: "8px 12px", fontSize: 12, color: "var(--h421-gray-400)" };
const celda: React.CSSProperties = { padding: "10px 12px" };
