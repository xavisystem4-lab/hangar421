"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuthCrm } from "@/lib/authClient";
import { StatTile } from "@/components/StatTile";
import { BotonesExportar } from "@/components/BotonesExportar";
import { exportarProductosVendidosExcel, exportarProductosVendidosPdf, type FilaProductoVendido } from "@/lib/exportarVentas";

interface Respuesta {
  productoId: string;
  nombre?: string;
  categoria?: string | null;
  subcategoria?: string | null;
  cantidad?: number;
  _sum: { cantidad: number | null };
  importe?: number;
  tickets?: number;
  variantes?: { descripcion: string; cantidad: number }[];
}

type Orden = "unidades" | "importe" | "nombre";

interface TurnoCaja {
  id: string;
  estado: "ABIERTO" | "CERRADO";
  fechaApertura: string;
  fechaCierre: string | null;
  sucursal: { id: string; nombre: string };
  caja: { id: string; nombre: string };
  usuario: { id: string; nombre: string };
}

const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
/** "de la mañana / tarde / noche" según la hora en que abrió. */
function momento(iso: string): string {
  const h = new Date(iso).getHours();
  return h < 12 ? "de la mañana" : h < 18 ? "de la tarde" : "de la noche";
}
function etiquetaTurno(t: TurnoCaja, conSucursal: boolean, conFecha: boolean): string {
  const fecha = conFecha ? `${new Date(t.fechaApertura).toLocaleDateString("es-MX", { day: "2-digit", month: "2-digit" })} ` : "";
  const rango = `${hora(t.fechaApertura)}–${t.fechaCierre ? hora(t.fechaCierre) : "ahora"}`;
  const estado = t.estado === "ABIERTO" ? "🟢 En curso" : `Turno ${momento(t.fechaApertura)}`;
  return `${estado} · ${fecha}${rango} · ${t.usuario?.nombre ?? "—"}${conSucursal ? ` · ${t.sucursal?.nombre ?? ""}` : ""}`;
}

const dinero = (n: number) => `$${(n ?? 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const SIN_CATEGORIA = "Sin categoría";
/** Quita acentos y mayúsculas para que "cafe" encuentre "Café". */
const normalizar = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Reportes → Productos vendidos: qué se vendió (ventas cobradas) en el día o rango elegido, con
 * buscador (nombre o modificador) y filtro por categoría. Unidades, importe, tickets en los que
 * aparece y el desglose por modificadores. Exporta lo que está filtrado a PDF y Excel.
 */
export function ReporteProductosVendidos({ sucursalId, sucursalNombre, desde, hasta }: { sucursalId: string; sucursalNombre?: string; desde: string; hasta: string }) {
  const { contexto } = useAuthCrm();
  const [filas, setFilas] = useState<FilaProductoVendido[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [categoria, setCategoria] = useState("");
  const [orden, setOrden] = useState<Orden>("unidades");
  const [abierto, setAbierto] = useState<string | null>(null);
  const [turnos, setTurnos] = useState<TurnoCaja[]>([]);
  const [turnoId, setTurnoId] = useState("");

  // Turnos de caja del rango (y los que siguen abiertos desde antes), para el filtro de turno.
  useEffect(() => {
    if (!contexto) return;
    const q = new URLSearchParams({ desde, hasta });
    if (sucursalId) q.set("sucursalId", sucursalId);
    apiFetch<{ items: TurnoCaja[]; pendientes: TurnoCaja[] }>(`/caja/turnos?${q}`)
      .then((r) => {
        const todos = new Map<string, TurnoCaja>();
        for (const t of [...(r.pendientes ?? []), ...(r.items ?? [])]) todos.set(t.id, t);
        const lista = [...todos.values()].sort((a, b) => a.fechaApertura.localeCompare(b.fechaApertura));
        setTurnos(lista);
        setTurnoId((actual) => (actual && !todos.has(actual) ? "" : actual));
      })
      .catch(() => setTurnos([]));
  }, [contexto, sucursalId, desde, hasta]);

  useEffect(() => {
    if (!contexto) return;
    setCargando(true);
    setError(null);
    const q = new URLSearchParams({
      empresaId: contexto.usuario.empresaId,
      desde: new Date(`${desde}T00:00:00`).toISOString(),
      hasta: new Date(`${hasta}T23:59:59`).toISOString(),
    });
    if (sucursalId) q.set("sucursalId", sucursalId);
    if (turnoId) q.set("turnoId", turnoId);
    apiFetch<Respuesta[]>(`/reportes/ventas-por-producto?${q}`)
      .then((r) =>
        setFilas(
          r.map((p) => ({
            productoId: p.productoId,
            nombre: p.nombre ?? "—",
            categoria: p.categoria || SIN_CATEGORIA,
            subcategoria: p.subcategoria ?? null,
            unidades: p.cantidad ?? p._sum.cantidad ?? 0,
            importe: p.importe ?? 0,
            tickets: p.tickets ?? 0,
            variantes: p.variantes ?? [],
          })),
        ),
      )
      .catch((e) => setError(e?.message ?? "No se pudo cargar el reporte."))
      .finally(() => setCargando(false));
  }, [contexto, sucursalId, desde, hasta, turnoId]);

  const varios = desde !== hasta;
  const turnoElegido = turnos.find((t) => t.id === turnoId);
  const enCurso = turnos.filter((t) => t.estado === "ABIERTO");

  // Categorías con cuántos productos y unidades tiene cada una, para el selector.
  const categorias = useMemo(() => {
    const m = new Map<string, { productos: number; unidades: number }>();
    for (const f of filas) {
      const g = m.get(f.categoria) ?? { productos: 0, unidades: 0 };
      g.productos += 1;
      g.unidades += f.unidades;
      m.set(f.categoria, g);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "es"));
  }, [filas]);

  const visibles = useMemo(() => {
    const texto = normalizar(busqueda.trim());
    const r = filas.filter(
      (f) =>
        (!categoria || f.categoria === categoria) &&
        (!texto || normalizar(`${f.nombre} ${f.subcategoria ?? ""} ${f.variantes.map((v) => v.descripcion).join(" ")}`).includes(texto)),
    );
    return r.sort((a, b) =>
      orden === "nombre" ? a.nombre.localeCompare(b.nombre, "es") : orden === "importe" ? b.importe - a.importe || b.unidades - a.unidades : b.unidades - a.unidades || b.importe - a.importe,
    );
  }, [filas, busqueda, categoria, orden]);

  const unidades = visibles.reduce((s, f) => s + f.unidades, 0);
  const importe = visibles.reduce((s, f) => s + f.importe, 0);
  const totalUnidades = filas.reduce((s, f) => s + f.unidades, 0);
  const filtros = [
    turnoElegido && etiquetaTurno(turnoElegido, !sucursalId, true).replace("🟢 ", ""),
    categoria && `Categoría: ${categoria}`,
    busqueda.trim() && `Búsqueda: "${busqueda.trim()}"`,
  ].filter(Boolean) as string[];
  const datosExport = { sucursal: sucursalNombre ?? "Todas las sucursales", desde, hasta, filtros, filas: visibles };

  return (
    <div style={{ marginTop: 12 }}>
      <div className="card" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={campo}>
          <span style={etiqueta}>Buscar producto</span>
          <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Ej. Latte, avena, matcha…" style={{ ...entrada, minWidth: 240 }} autoFocus />
        </label>
        <label style={campo}>
          <span style={etiqueta}>Turno</span>
          <select value={turnoId} onChange={(e) => setTurnoId(e.target.value)} style={{ ...entrada, minWidth: 260 }}>
            <option value="">Todos los turnos {varios ? "del rango" : "del día"}</option>
            {turnos.map((t) => (
              <option key={t.id} value={t.id}>{etiquetaTurno(t, !sucursalId, varios || t.fechaApertura.slice(0, 10) !== desde)}</option>
            ))}
          </select>
        </label>
        <label style={campo}>
          <span style={etiqueta}>Categoría</span>
          <select value={categoria} onChange={(e) => setCategoria(e.target.value)} style={{ ...entrada, minWidth: 200 }}>
            <option value="">Todas ({filas.length} productos)</option>
            {categorias.map(([c, g]) => (
              <option key={c} value={c}>{c} ({g.productos} · {g.unidades} u)</option>
            ))}
          </select>
        </label>
        <label style={campo}>
          <span style={etiqueta}>Ordenar por</span>
          <select value={orden} onChange={(e) => setOrden(e.target.value as Orden)} style={entrada}>
            <option value="unidades">Más vendidos (unidades)</option>
            <option value="importe">Mayor importe</option>
            <option value="nombre">Nombre (A-Z)</option>
          </select>
        </label>
        {enCurso.length > 0 && !turnoId && (
          <button onClick={() => setTurnoId(enCurso[enCurso.length - 1].id)} style={{ padding: "9px 12px", background: "rgba(22,163,74,0.12)", border: "1px solid var(--h421-green)", color: "var(--h421-green)", fontWeight: 700 }}>
            🟢 Ver turno en curso
          </button>
        )}
        {(busqueda || categoria || turnoId) && (
          <button onClick={() => { setBusqueda(""); setCategoria(""); setTurnoId(""); }} style={{ padding: "9px 12px", background: "transparent", textDecoration: "underline" }}>
            Quitar filtros
          </button>
        )}
        <span style={{ marginLeft: "auto" }}>
          <BotonesExportar
            deshabilitado={cargando || visibles.length === 0}
            onPdf={() => exportarProductosVendidosPdf(datosExport)}
            onExcel={() => exportarProductosVendidosExcel(datosExport)}
          />
        </span>
      </div>

      {turnoElegido && (
        <p style={{ margin: "10px 0 0", fontSize: 14 }}>
          Mostrando lo vendido en el <strong>{etiquetaTurno(turnoElegido, !sucursalId, true).replace("🟢 En curso", "turno en curso")}</strong>
          {" "}(caja {turnoElegido.caja?.nombre ?? "—"}).
        </p>
      )}
      {!sucursalId && turnos.length > 0 && !turnoId && (
        <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--h421-gray-400)" }}>Elige una sucursal arriba para ver solo sus turnos.</p>
      )}
      {error && <p style={{ color: "var(--h421-red)" }}>{error}</p>}
      {cargando && <p style={{ color: "var(--h421-gray-400)" }}>Cargando…</p>}

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 12 }}>
        <StatTile etiqueta={filtros.length ? "Productos (filtrados)" : "Productos distintos vendidos"} valor={String(visibles.length)} acento="var(--h421-blue)" />
        <StatTile etiqueta="Unidades vendidas" valor={String(unidades)} acento="var(--h421-amber)" />
        <StatTile etiqueta="Importe" valor={dinero(importe)} acento="var(--h421-green)" />
      </div>

      <div className="card h421-tabla-wrap" style={{ marginTop: 16, overflowX: "auto" }}>
        {!cargando && visibles.length === 0 ? (
          <p style={{ margin: 0, color: "var(--h421-gray-400)" }}>
            {filas.length === 0 ? "No se vendieron productos en este periodo." : "Ningún producto coincide con la búsqueda o la categoría."}
          </p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ color: "var(--h421-gray-400)", fontSize: 12, textAlign: "right", borderBottom: "1px solid var(--h421-gray-200)" }}>
                <th style={{ textAlign: "left", padding: "8px 6px", width: 32 }}>#</th>
                <th style={{ textAlign: "left", padding: "8px 6px" }}>Producto</th>
                <th style={{ textAlign: "left", padding: "8px 6px" }}>Categoría</th>
                <th style={{ padding: "8px 6px" }}>Unidades</th>
                <th style={{ padding: "8px 6px" }}>Tickets</th>
                <th style={{ padding: "8px 6px" }}>Importe</th>
                <th style={{ padding: "8px 6px", width: 140 }}>% de unidades</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((f, i) => {
                const pct = totalUnidades > 0 ? (f.unidades / totalUnidades) * 100 : 0;
                const desplegable = f.variantes.length > 0;
                return (
                  <FilaProducto key={f.productoId} f={f} i={i} pct={pct} abierto={abierto === f.productoId} desplegable={desplegable}
                    onClick={() => desplegable && setAbierto(abierto === f.productoId ? null : f.productoId)} />
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 800, borderTop: "2px solid var(--h421-gray-200)", textAlign: "right" }}>
                <td colSpan={3} style={{ textAlign: "left", padding: "10px 6px" }}>Total{filtros.length ? " (con filtros)" : ""}</td>
                <td style={{ padding: "10px 6px" }}>{unidades}</td>
                <td />
                <td style={{ padding: "10px 6px" }}>{dinero(importe)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
        <p style={{ fontSize: 12, color: "var(--h421-gray-400)", margin: "10px 0 0" }}>
          Solo ventas cobradas. El importe es cantidad × precio del producto (sin descuentos del ticket ni extras con precio). Toca un producto con ▸ para ver con qué modificadores se vendió.
        </p>
      </div>
    </div>
  );
}

function FilaProducto({ f, i, pct, abierto, desplegable, onClick }: { f: FilaProductoVendido; i: number; pct: number; abierto: boolean; desplegable: boolean; onClick: () => void }) {
  return (
    <>
      <tr onClick={onClick} style={{ borderBottom: "1px solid var(--h421-gray-200)", textAlign: "right", cursor: desplegable ? "pointer" : "default" }}>
        <td style={{ textAlign: "left", padding: "8px 6px", color: "var(--h421-gray-400)" }}>{i + 1}</td>
        <td style={{ textAlign: "left", padding: "8px 6px", fontWeight: 600 }}>
          {desplegable ? (abierto ? "▾ " : "▸ ") : ""}{f.nombre}
          {f.subcategoria && <span style={{ fontSize: 12, color: "var(--h421-gray-400)", fontWeight: 400 }}> · {f.subcategoria}</span>}
        </td>
        <td style={{ textAlign: "left", padding: "8px 6px", color: "var(--h421-gray-400)", fontSize: 13 }}>{f.categoria}</td>
        <td style={{ padding: "8px 6px", fontWeight: 800 }}>{f.unidades}</td>
        <td style={{ padding: "8px 6px" }}>{f.tickets}</td>
        <td style={{ padding: "8px 6px" }}>{dinero(f.importe)}</td>
        <td style={{ padding: "8px 6px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
            <div style={{ width: 70, height: 6, borderRadius: 3, background: "var(--h421-gray-200)", overflow: "hidden" }}>
              <div style={{ width: `${Math.min(100, pct)}%`, height: 6, background: "#FF6A13" }} />
            </div>
            <span style={{ fontSize: 12, minWidth: 40 }}>{pct.toFixed(1)}%</span>
          </div>
        </td>
      </tr>
      {abierto && (
        <tr>
          <td />
          <td colSpan={6} style={{ padding: "4px 6px 12px", background: "var(--h421-gray-50)" }}>
            {f.variantes.map((v) => (
              <div key={v.descripcion} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0", maxWidth: 520 }}>
                <span>{v.descripcion === "Sin modificadores" ? <em>Sin modificadores</em> : v.descripcion}</span>
                <strong>{v.cantidad} u</strong>
              </div>
            ))}
          </td>
        </tr>
      )}
    </>
  );
}

const campo: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4 };
const etiqueta: React.CSSProperties = { fontSize: 12, color: "var(--h421-gray-400)", fontWeight: 700 };
const entrada: React.CSSProperties = { padding: "9px 10px", borderRadius: 8, border: "1px solid var(--h421-gray-200)" };
