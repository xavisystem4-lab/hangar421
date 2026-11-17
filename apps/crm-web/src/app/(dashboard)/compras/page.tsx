"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  SECCIONES_INSUMO, UNIDADES_INSUMO, calcularCompra, costoEnUnidadCaptura, factorConversionUnidad, rangoDePeriodo, resumirCompras,
  seccionDeInsumo, uuid7, type CompraRegistro, type PeriodoCompras,
} from "@hangar421/shared";
import { apiFetch } from "@/lib/api";
import { useAuthCrm } from "@/lib/authClient";
import { useSucursalActiva } from "@/store/sucursalActiva";
import { StatTile } from "@/components/StatTile";
import { exportarComprasCsv, exportarComprasExcel, exportarComprasPdf, type DatosExportCompras } from "@/lib/exportarCompras";

/**
 * ERP → 🛒 Compras y costos.
 *
 * Registrar una compra (cuánto se compró, en qué unidad, cuánto se pagó, a quién y cuándo) mete
 * la mercancía al inventario y guarda el precio en el historial sin borrar los anteriores. Aquí
 * se consulta cuánto se invirtió, cuánto costó cada insumo en el tiempo y qué subió de precio.
 * Registrar y anular es solo para administradores (el backend lo exige; aquí solo se oculta).
 */

interface Insumo {
  id: string;
  nombre: string;
  unidadMedida: string;
  presentacionNombre?: string | null;
  presentacionCantidad?: number | string | null;
  proveedorId: string | null;
  esPreparacion?: boolean;
  activo?: boolean;
}
interface Proveedor { id: string; nombre: string; activo?: boolean }
type Compra = CompraRegistro & { notas: string | null; anuladaAt: string | null; anuladaPor: string | null; motivoAnulacion: string | null; usuarioId: string | null; proveedorId: string | null };
type Vista = "tablero" | "historial" | "producto";

const dinero = (n: number) => `$${(Number(n) || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const cant = (n: number) => (Number(n) || 0).toLocaleString("es-MX", { maximumFractionDigits: 3 });
const fecha = (iso: string) => new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const etiquetaMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const PERIODOS: [PeriodoCompras, string][] = [["hoy", "Hoy"], ["ayer", "Ayer"], ["7dias", "7 días"], ["mes", "Este mes"], ["mesAnterior", "Mes anterior"], ["anio", "Este año"]];
const esAdmin = (rol?: string) => rol === "ADMIN_CORPORATIVO" || rol === "ADMIN_SUCURSAL";
const inputStyle: React.CSSProperties = { padding: 9, borderRadius: 8, border: "1px solid var(--h421-gray-200)", width: "100%" };

/** Unidades en que se puede capturar la compra de un insumo, con su factor a la unidad base. */
function unidadesDeCompra(i: Insumo | undefined): { etiqueta: string; unidad: string; factor: number }[] {
  if (!i) return [];
  const lista = [{ etiqueta: i.unidadMedida, unidad: i.unidadMedida, factor: 1 }];
  const porPaquete = Number(i.presentacionCantidad);
  if (i.presentacionNombre && porPaquete > 0) lista.push({ etiqueta: `${i.presentacionNombre} (${cant(porPaquete)} ${i.unidadMedida})`, unidad: i.presentacionNombre, factor: porPaquete });
  for (const u of UNIDADES_INSUMO) {
    if (u === i.unidadMedida) continue;
    const f = factorConversionUnidad(u, i.unidadMedida);
    if (f && f > 0) lista.push({ etiqueta: `${u} (${cant(f)} ${i.unidadMedida})`, unidad: u, factor: f });
  }
  return lista;
}

function hoyLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ComprasPage() {
  const { contexto } = useAuthCrm();
  const { seleccion } = useSucursalActiva();
  const admin = esAdmin(contexto?.rol);
  const sucursalId = seleccion?.sucursalId ?? "";

  const [vista, setVista] = useState<Vista>("tablero");
  const inicial = rangoDePeriodo("mes", new Date());
  const [periodo, setPeriodo] = useState<PeriodoCompras | "rango">("mes");
  const [desde, setDesde] = useState(inicial.desde);
  const [hasta, setHasta] = useState(inicial.hasta);
  const [insumoId, setInsumoId] = useState("");
  const [categoria, setCategoria] = useState("");
  const [proveedorId, setProveedorId] = useState("");
  const [usuarioId, setUsuarioId] = useState("");
  const [incluirAnuladas, setIncluirAnuladas] = useState(false);

  const [insumos, setInsumos] = useState<Insumo[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [compras, setCompras] = useState<Compra[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [registrando, setRegistrando] = useState(false);
  const [anulando, setAnulando] = useState<Compra | null>(null);
  const [exportando, setExportando] = useState<string | null>(null);

  useEffect(() => {
    if (!contexto) return;
    const e = contexto.usuario.empresaId;
    apiFetch<Insumo[]>(`/inventario/insumos?empresaId=${e}`).then((l) => setInsumos(l.filter((i) => !i.esPreparacion && i.activo !== false).sort((a, b) => a.nombre.localeCompare(b.nombre, "es")))).catch(() => undefined);
    apiFetch<Proveedor[]>(`/proveedores?empresaId=${e}`).then((l) => setProveedores(l.filter((p) => p.activo !== false))).catch(() => undefined);
  }, [contexto]);

  const cargar = useCallback(async () => {
    if (!contexto) return;
    setCargando(true);
    setError(null);
    try {
      const q = new URLSearchParams({ desde, hasta });
      if (sucursalId) q.set("sucursalId", sucursalId);
      if (insumoId) q.set("insumoId", insumoId);
      if (categoria) q.set("categoria", categoria);
      if (proveedorId) q.set("proveedorId", proveedorId);
      if (usuarioId) q.set("usuarioId", usuarioId);
      if (incluirAnuladas) q.set("incluirAnuladas", "1");
      const r = await apiFetch<{ items: Compra[] }>(`/inventario/compras?${q}`);
      setCompras(r.items);
    } catch (e: any) {
      setError(e?.message ?? "No se pudieron cargar las compras.");
    } finally {
      setCargando(false);
    }
  }, [contexto, sucursalId, desde, hasta, insumoId, categoria, proveedorId, usuarioId, incluirAnuladas]);

  useEffect(() => { cargar(); }, [cargar]);

  const resumen = useMemo(() => resumirCompras(compras), [compras]);
  const usuarios = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of compras) if (c.usuarioId) m.set(c.usuarioId, c.usuario ?? "—");
    return [...m.entries()];
  }, [compras]);

  function elegirPeriodo(p: PeriodoCompras) {
    const r = rangoDePeriodo(p, new Date());
    setPeriodo(p);
    setDesde(r.desde);
    setHasta(r.hasta);
  }

  function datosExport(): DatosExportCompras {
    const filtros = [
      insumoId && `Insumo: ${insumos.find((i) => i.id === insumoId)?.nombre ?? ""}`,
      categoria && `Categoría: ${categoria}`,
      proveedorId && `Proveedor: ${proveedorId === "SIN" ? "Sin proveedor" : proveedores.find((p) => p.id === proveedorId)?.nombre ?? ""}`,
      usuarioId && `Registró: ${usuarios.find(([id]) => id === usuarioId)?.[1] ?? ""}`,
      incluirAnuladas && "Incluye anuladas",
    ].filter(Boolean) as string[];
    return { negocio: "HANGAR 421", sucursal: seleccion?.sucursalId ? seleccion.nombre ?? "Sucursal" : "Todas las sucursales", desde, hasta, filtros, compras, resumen };
  }

  async function exportar(tipo: "pdf" | "excel" | "csv") {
    setExportando(tipo);
    try {
      const d = datosExport();
      if (tipo === "pdf") await exportarComprasPdf(d);
      else if (tipo === "excel") await exportarComprasExcel(d);
      else await exportarComprasCsv(d);
    } catch (e: any) {
      if (e?.name !== "AbortError") setError(e?.message ?? "No se pudo exportar.");
    } finally {
      setExportando(null);
    }
  }

  const productoSel = vista === "producto" ? resumen.porInsumo.find((i) => i.insumoId === insumoId) : undefined;
  const maxMes = Math.max(1, ...resumen.porMes.map((m) => m.total));
  const maxInsumo = Math.max(1, ...resumen.porInsumo.map((i) => i.total));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div>
          <h1 style={{ margin: 0 }}>🛒 Compras y costos</h1>
          <p style={{ margin: "4px 0 0", color: "var(--h421-gray-400)", fontSize: 13 }}>
            {seleccion?.sucursalId ? seleccion.nombre : "Todas las sucursales"} · cada compra guarda su precio; el historial nunca se sobrescribe.
          </p>
        </div>
        {admin ? (
          <button onClick={() => { if (!sucursalId) setError("Elige una sucursal en la cabecera para registrar la compra."); else setRegistrando(true); }}
            style={{ background: "var(--h421-green)", color: "#fff", padding: "10px 16px", fontWeight: 800 }}>
            ＋ Registrar compra
          </button>
        ) : (
          <span style={{ fontSize: 12, color: "var(--h421-gray-400)" }}>Solo un administrador puede registrar compras.</span>
        )}
      </div>

      {/* Periodo y filtros: aplican a las tres vistas y a la exportación. */}
      <div className="card" style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {PERIODOS.map(([id, txt]) => (
            <button key={id} onClick={() => elegirPeriodo(id)} style={chip(periodo === id)}>{txt}</button>
          ))}
          <span style={{ fontSize: 13, marginLeft: 6 }}>Desde</span>
          <input type="date" value={desde} onChange={(e) => { setPeriodo("rango"); setDesde(e.target.value); }} style={{ padding: 7 }} />
          <span style={{ fontSize: 13 }}>Hasta</span>
          <input type="date" value={hasta} onChange={(e) => { setPeriodo("rango"); setHasta(e.target.value); }} style={{ padding: 7 }} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 8 }}>
          <select value={insumoId} onChange={(e) => setInsumoId(e.target.value)} style={inputStyle}>
            <option value="">Todos los insumos</option>
            {insumos.map((i) => <option key={i.id} value={i.id}>{i.nombre}</option>)}
          </select>
          <select value={categoria} onChange={(e) => setCategoria(e.target.value)} style={inputStyle}>
            <option value="">Todas las categorías</option>
            {SECCIONES_INSUMO.filter((s) => s !== "Preparaciones").map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)} style={inputStyle}>
            <option value="">Todos los proveedores</option>
            <option value="SIN">Sin proveedor</option>
            {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
          <select value={usuarioId} onChange={(e) => setUsuarioId(e.target.value)} style={inputStyle}>
            <option value="">Cualquier usuario</option>
            {usuarios.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
          </select>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            <input type="checkbox" checked={incluirAnuladas} onChange={(e) => setIncluirAnuladas(e.target.checked)} /> Ver anuladas
          </label>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {([["tablero", "📊 Tablero"], ["historial", "🧾 Historial"], ["producto", "🔎 Por insumo"]] as [Vista, string][]).map(([id, txt]) => (
            <button key={id} onClick={() => setVista(id)} style={chip(vista === id, true)}>{txt}</button>
          ))}
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            {([["pdf", "📄 PDF"], ["excel", "📊 Excel"], ["csv", "🧾 CSV"]] as const).map(([t, txt]) => (
              <button key={t} disabled={!!exportando || compras.length === 0} onClick={() => exportar(t)}
                style={{ padding: "7px 12px", border: "1px solid var(--h421-gray-200)", background: "transparent", opacity: compras.length === 0 ? 0.5 : 1 }}>
                {exportando === t ? "Generando…" : txt}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && <p style={{ color: "var(--h421-red)" }}>{error}</p>}
      {aviso && <p style={{ color: "var(--h421-green)", fontWeight: 700 }}>{aviso}</p>}
      {cargando && <p style={{ color: "var(--h421-gray-400)" }}>Cargando…</p>}

      {!cargando && vista === "tablero" && (
        <>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 14 }}>
            <StatTile etiqueta="Total invertido" valor={dinero(resumen.total)} acento="var(--h421-green)" />
            <StatTile etiqueta="Compras registradas" valor={String(resumen.compras)} acento="var(--h421-blue)" />
            <StatTile etiqueta="Insumos comprados" valor={String(resumen.porInsumo.length)} acento="var(--h421-amber)" />
            <StatTile etiqueta="Subieron de precio" valor={String(resumen.subieron.length)} acento="var(--h421-red)" />
          </div>
          {resumen.compras === 0 ? (
            <div className="card" style={{ marginTop: 16, color: "var(--h421-gray-400)" }}>No hay compras registradas en este periodo.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 16, marginTop: 16 }}>
              <div className="card">
                <h3 style={{ marginTop: 0 }}>Insumos con mayor inversión</h3>
                {resumen.porInsumo.slice(0, 10).map((i) => (
                  <Barra key={i.insumoId} etiqueta={i.insumo} detalle={`${i.compras} compra${i.compras === 1 ? "" : "s"} · ${cant(i.cantidadBase / i.factorCaptura)} ${i.unidadCaptura}`} valor={i.total} max={maxInsumo}
                    onClick={() => { setInsumoId(i.insumoId); setVista("producto"); }} />
                ))}
              </div>
              <div className="card">
                <h3 style={{ marginTop: 0 }}>Gasto por mes</h3>
                {resumen.porMes.map((m) => <Barra key={m.mes} etiqueta={etiquetaMes(m.mes)} detalle={`${m.compras} compra${m.compras === 1 ? "" : "s"}`} valor={m.total} max={maxMes} />)}
                <h3>Por categoría</h3>
                {resumen.porCategoria.map((g) => <Barra key={g.clave} etiqueta={g.clave} detalle={`${g.porcentaje}%`} valor={g.total} max={resumen.porCategoria[0]?.total ?? 1} />)}
              </div>
              <div className="card">
                <h3 style={{ marginTop: 0 }}>📈 Subieron de precio en el periodo</h3>
                {resumen.subieron.length === 0 && <p style={{ color: "var(--h421-gray-400)", fontSize: 13 }}>Ningún insumo subió de precio (se compara la primera y la última compra del periodo).</p>}
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <tbody>
                    {resumen.subieron.map((i) => (
                      <tr key={i.insumoId} style={{ borderTop: "1px solid var(--h421-gray-200)", cursor: "pointer" }} onClick={() => { setInsumoId(i.insumoId); setVista("producto"); }}>
                        <td style={{ padding: 6, fontWeight: 700 }}>{i.insumo}</td>
                        <td style={{ padding: 6, textAlign: "right" }}>{dinero(costoEnUnidadCaptura(i.primerCostoBase, i.factorCaptura))} → {dinero(costoEnUnidadCaptura(i.ultimoCostoBase, i.factorCaptura))} / {i.unidadCaptura}</td>
                        <td style={{ padding: 6, textAlign: "right", color: "var(--h421-red)", fontWeight: 800 }}>+{i.variacionPct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <h3>Por proveedor</h3>
                {resumen.porProveedor.map((g) => <Barra key={g.clave} etiqueta={g.clave} detalle={`${g.compras} compra${g.compras === 1 ? "" : "s"} · ${g.porcentaje}%`} valor={g.total} max={resumen.porProveedor[0]?.total ?? 1} />)}
              </div>
            </div>
          )}
        </>
      )}

      {!cargando && vista === "historial" && (
        <div className="card" style={{ marginTop: 16, overflowX: "auto" }}>
          <TablaCompras compras={compras} admin={admin} onAnular={setAnulando} onInsumo={(id) => { setInsumoId(id); setVista("producto"); }} />
        </div>
      )}

      {!cargando && vista === "producto" && (
        <div style={{ marginTop: 16 }}>
          {!insumoId ? (
            <div className="card">
              <p style={{ marginTop: 0 }}>Elige un insumo para ver su historial de precios:</p>
              <select value={insumoId} onChange={(e) => setInsumoId(e.target.value)} style={{ ...inputStyle, maxWidth: 360 }}>
                <option value="">— Insumo —</option>
                {insumos.map((i) => <option key={i.id} value={i.id}>{i.nombre}</option>)}
              </select>
            </div>
          ) : !productoSel ? (
            <div className="card" style={{ color: "var(--h421-gray-400)" }}>
              {insumos.find((i) => i.id === insumoId)?.nombre ?? "Este insumo"} no tiene compras en el periodo. Prueba con «Este año» o un rango más amplio.
            </div>
          ) : (
            <>
              <h2 style={{ marginTop: 0 }}>{productoSel.insumo}</h2>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                <StatTile etiqueta={`Último precio (${fecha(productoSel.ultimaFecha)})`} valor={`${dinero(costoEnUnidadCaptura(productoSel.ultimoCostoBase, productoSel.factorCaptura))} / ${productoSel.unidadCaptura}`} acento="var(--h421-navy-texto)" />
                <StatTile etiqueta="Precio promedio" valor={`${dinero(costoEnUnidadCaptura(productoSel.costoPromedioBase, productoSel.factorCaptura))} / ${productoSel.unidadCaptura}`} acento="var(--h421-amber)" />
                <StatTile etiqueta="Cantidad comprada" valor={`${cant(productoSel.cantidadBase / productoSel.factorCaptura)} ${productoSel.unidadCaptura}`} acento="var(--h421-blue)" />
                <StatTile etiqueta={`Invertido (${productoSel.compras} compra${productoSel.compras === 1 ? "" : "s"})`} valor={dinero(productoSel.total)} acento="var(--h421-green)" />
                <StatTile etiqueta="Variación en el periodo" valor={`${productoSel.variacionPct > 0 ? "+" : ""}${productoSel.variacionPct}%`} acento={productoSel.variacionPct > 0 ? "var(--h421-red)" : "var(--h421-green)"} />
              </div>
              <p style={{ fontSize: 13, color: "var(--h421-gray-400)" }}>
                Mínimo {dinero(costoEnUnidadCaptura(productoSel.minimoBase, productoSel.factorCaptura))} · máximo {dinero(costoEnUnidadCaptura(productoSel.maximoBase, productoSel.factorCaptura))} por {productoSel.unidadCaptura}
                {" "}· en unidad de inventario: {dinero(productoSel.costoPromedioBase)} por {productoSel.unidadBase} (promedio).
              </p>
              <div className="card" style={{ overflowX: "auto" }}>
                <h3 style={{ marginTop: 0 }}>Todas sus compras</h3>
                <TablaCompras compras={compras.filter((c) => c.insumoId === insumoId)} admin={admin} onAnular={setAnulando} conVariacion />
              </div>
            </>
          )}
        </div>
      )}

      {registrando && contexto && (
        <ModalCompra
          insumos={insumos}
          proveedores={proveedores}
          sucursalId={sucursalId}
          sucursalNombre={seleccion?.nombre ?? ""}
          onCerrar={() => setRegistrando(false)}
          onGuardada={(c) => { setRegistrando(false); setAviso(`✓ Compra registrada: ${cant(c.cantidadCaptura)} ${c.unidadCaptura} de ${c.insumo} por ${dinero(c.total)}. Ya entró al inventario.`); cargar(); }}
        />
      )}

      {anulando && (
        <ModalAnular compra={anulando} onCerrar={() => setAnulando(null)} onAnulada={() => { setAnulando(null); setAviso("Compra anulada: se regresó la existencia y quedó en la bitácora."); cargar(); }} />
      )}
    </div>
  );
}

function chip(activo: boolean, fuerte = false): React.CSSProperties {
  return {
    padding: fuerte ? "8px 14px" : "6px 12px", fontSize: 13, fontWeight: 700, borderRadius: 999,
    background: activo ? "var(--h421-navy)" : "transparent", color: activo ? "#fff" : "var(--h421-navy-texto)",
    border: `1px solid ${activo ? "var(--h421-navy)" : "var(--h421-gray-200)"}`,
  };
}

function Barra({ etiqueta, detalle, valor, max, onClick }: { etiqueta: string; detalle?: string; valor: number; max: number; onClick?: () => void }) {
  return (
    <div onClick={onClick} style={{ marginBottom: 10, cursor: onClick ? "pointer" : undefined }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, gap: 8 }}>
        <span style={{ fontWeight: 700 }}>{etiqueta}{detalle && <span style={{ fontWeight: 400, color: "var(--h421-gray-400)" }}> · {detalle}</span>}</span>
        <strong>{dinero(valor)}</strong>
      </div>
      <div style={{ height: 7, background: "var(--h421-gray-200)", borderRadius: 4, marginTop: 3 }}>
        <div style={{ width: `${(valor / max) * 100}%`, height: "100%", background: "var(--h421-amber)", borderRadius: 4 }} />
      </div>
    </div>
  );
}

function TablaCompras({ compras, admin, onAnular, onInsumo, conVariacion }: { compras: Compra[]; admin: boolean; onAnular: (c: Compra) => void; onInsumo?: (id: string) => void; conVariacion?: boolean }) {
  if (compras.length === 0) return <p style={{ color: "var(--h421-gray-400)" }}>Sin compras con estos filtros.</p>;
  // Variación contra la compra anterior del mismo insumo (en orden de fecha).
  const anterior = new Map<string, number>();
  if (conVariacion) {
    const ordenadas = [...compras].filter((c) => c.estado !== "ANULADA").sort((a, b) => a.fechaCompra.localeCompare(b.fechaCompra));
    let previo: number | null = null;
    for (const c of ordenadas) {
      if (previo != null && previo > 0) anterior.set(c.id, Math.round(((c.costoUnitarioBase - previo) / previo) * 10_000) / 100);
      previo = c.costoUnitarioBase;
    }
  }
  const total = compras.filter((c) => c.estado !== "ANULADA").reduce((s, c) => s + c.total, 0);
  const th: React.CSSProperties = { padding: 8, textAlign: "left", color: "var(--h421-gray-400)", fontSize: 12, whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: 8, borderTop: "1px solid var(--h421-gray-200)", verticalAlign: "top" };
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr>
          <th style={th}>Fecha</th><th style={th}>Insumo</th><th style={{ ...th, textAlign: "right" }}>Cantidad</th><th style={{ ...th, textAlign: "right" }}>Precio unitario</th>
          <th style={{ ...th, textAlign: "right" }}>Total</th>{conVariacion && <th style={{ ...th, textAlign: "right" }}>vs. anterior</th>}
          <th style={th}>Proveedor</th><th style={th}>Registró</th><th style={th}>Sucursal</th><th style={th}></th>
        </tr>
      </thead>
      <tbody>
        {compras.map((c) => {
          const anulada = c.estado === "ANULADA";
          const v = anterior.get(c.id);
          return (
            <tr key={c.id} style={{ opacity: anulada ? 0.55 : 1 }}>
              <td style={td}>{fecha(c.fechaCompra)}</td>
              <td style={td}>
                <span style={{ fontWeight: 700, cursor: onInsumo ? "pointer" : undefined, textDecoration: anulada ? "line-through" : undefined }} onClick={() => onInsumo?.(c.insumoId)}>{c.insumo}</span>
                <div style={{ fontSize: 11, color: "var(--h421-gray-400)" }}>
                  {c.categoria} · entra {cant(c.cantidadBase)} {c.unidadBase}{c.notas ? ` · ${c.notas}` : ""}
                </div>
                {anulada && <div style={{ fontSize: 11, color: "var(--h421-red)" }}>Anulada por {c.anuladaPor ?? "—"}{c.anuladaAt ? ` el ${fecha(c.anuladaAt)}` : ""}: {c.motivoAnulacion}</div>}
              </td>
              <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>{cant(c.cantidadCaptura)} {c.unidadCaptura}</td>
              <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>{dinero(c.precioCaptura)} / {c.unidadCaptura}</td>
              <td style={{ ...td, textAlign: "right", fontWeight: 800 }}>{dinero(c.total)}</td>
              {conVariacion && (
                <td style={{ ...td, textAlign: "right", fontWeight: 700, color: v == null ? undefined : v > 0 ? "var(--h421-red)" : v < 0 ? "var(--h421-green)" : undefined }}>
                  {v == null ? "—" : `${v > 0 ? "▲ +" : v < 0 ? "▼ " : ""}${v}%`}
                </td>
              )}
              <td style={td}>{c.proveedor ?? "—"}</td>
              <td style={td}>{c.usuario ?? "—"}</td>
              <td style={td}>{c.sucursal ?? "—"}</td>
              <td style={td}>
                {admin && !anulada && (
                  <button onClick={() => onAnular(c)} style={{ padding: "4px 10px", fontSize: 12, background: "transparent", border: "1px solid var(--h421-red)", color: "var(--h421-red)" }}>Anular</button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr>
          <td style={{ ...td, fontWeight: 800 }} colSpan={4}>Total ({compras.filter((c) => c.estado !== "ANULADA").length} compras vigentes)</td>
          <td style={{ ...td, textAlign: "right", fontWeight: 800 }}>{dinero(total)}</td>
          <td style={td} colSpan={conVariacion ? 5 : 4}></td>
        </tr>
      </tfoot>
    </table>
  );
}

function Modal({ titulo, onCerrar, children }: { titulo: string; onCerrar: () => void; children: React.ReactNode }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}>
      <div className="card" style={{ width: 520, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{titulo}</h2>
          <button onClick={onCerrar} style={{ background: "none", fontSize: 20 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalCompra({ insumos, proveedores, sucursalId, sucursalNombre, onCerrar, onGuardada }: {
  insumos: Insumo[]; proveedores: Proveedor[]; sucursalId: string; sucursalNombre: string; onCerrar: () => void; onGuardada: (c: Compra) => void;
}) {
  // Llave única por captura: si se da doble clic o se reintenta, el ERP no la duplica.
  const [llave] = useState(() => uuid7());
  const [busqueda, setBusqueda] = useState("");
  const [insumoId, setInsumoId] = useState("");
  const insumo = insumos.find((i) => i.id === insumoId);
  const unidades = unidadesDeCompra(insumo);
  const [unidadIdx, setUnidadIdx] = useState(0);
  const [cantidad, setCantidad] = useState("");
  const [modo, setModo] = useState<"precio" | "total">("precio");
  const [precio, setPrecio] = useState("");
  const [totalTxt, setTotalTxt] = useState("");
  const [proveedorId, setProveedorId] = useState("");
  const [dia, setDia] = useState(hoyLocal());
  const [notas, setNotas] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visibles = insumos.filter((i) => !busqueda.trim() || `${i.nombre} ${seccionDeInsumo(i)}`.toLowerCase().includes(busqueda.trim().toLowerCase())).slice(0, 60);
  const unidad = unidades[unidadIdx] ?? unidades[0];

  let calc: ReturnType<typeof calcularCompra> | null = null;
  let errorCalc: string | null = null;
  if (insumo && unidad && cantidad) {
    try {
      calc = calcularCompra({ cantidadCaptura: Number(cantidad), factor: unidad.factor, precioCaptura: modo === "precio" ? (precio === "" ? null : Number(precio)) : null, total: modo === "total" ? (totalTxt === "" ? null : Number(totalTxt)) : null });
    } catch (e: any) {
      errorCalc = e.message;
    }
  }

  async function guardar() {
    if (!insumo || !unidad || !calc) return;
    setGuardando(true);
    setError(null);
    try {
      // Hoy = ahora mismo; otro día = a mediodía de ese día (así no cambia de fecha por la zona horaria).
      const fechaCompra = dia === hoyLocal() ? new Date().toISOString() : new Date(`${dia}T12:00:00`).toISOString();
      const c = await apiFetch<Compra>("/inventario/compras", {
        method: "POST",
        body: JSON.stringify({
          sucursalId, insumoId: insumo.id, proveedorId: proveedorId || null, fechaCompra, unidadCaptura: unidad.unidad, cantidadCaptura: Number(cantidad),
          factor: unidad.factor, precioCaptura: modo === "precio" ? Number(precio) : null, total: modo === "total" ? Number(totalTxt) : null, notas: notas.trim() || null, idempotencyKey: llave,
        }),
      });
      onGuardada(c);
    } catch (e: any) {
      setError(e?.message ?? "No se pudo registrar la compra.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal titulo={`Registrar compra · ${sucursalNombre}`} onCerrar={onCerrar}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <label style={{ fontSize: 13, fontWeight: 700 }}>Insumo</label>
        {insumo ? (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 10, border: "1px solid var(--h421-gray-200)", borderRadius: 8 }}>
            <span><strong>{insumo.nombre}</strong> <span style={{ color: "var(--h421-gray-400)", fontSize: 12 }}>· {seccionDeInsumo(insumo)} · inventario en {insumo.unidadMedida}</span></span>
            <button onClick={() => { setInsumoId(""); setUnidadIdx(0); }} style={{ background: "none", textDecoration: "underline", fontSize: 12 }}>Cambiar</button>
          </div>
        ) : (
          <>
            <input autoFocus placeholder="Buscar insumo (leche, café, vasos…)" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} style={inputStyle} />
            <div style={{ maxHeight: 200, overflowY: "auto", border: "1px solid var(--h421-gray-200)", borderRadius: 8 }}>
              {visibles.map((i) => (
                <div key={i.id} onClick={() => { setInsumoId(i.id); setUnidadIdx(i.presentacionNombre ? 1 : 0); setProveedorId(i.proveedorId ?? ""); }}
                  style={{ padding: "8px 10px", cursor: "pointer", borderBottom: "1px solid var(--h421-gray-200)", fontSize: 13 }}>
                  <strong>{i.nombre}</strong> <span style={{ color: "var(--h421-gray-400)" }}>· {seccionDeInsumo(i)} · {i.unidadMedida}</span>
                </div>
              ))}
              {visibles.length === 0 && <div style={{ padding: 10, color: "var(--h421-gray-400)", fontSize: 13 }}>No hay insumos con ese nombre. Dalo de alta en Inventario.</div>}
            </div>
          </>
        )}

        {insumo && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <label style={{ fontSize: 13, fontWeight: 700 }}>Cantidad comprada</label>
                <input type="number" min="0" step="any" value={cantidad} onChange={(e) => setCantidad(e.target.value)} style={inputStyle} placeholder="20" />
              </div>
              <div>
                <label style={{ fontSize: 13, fontWeight: 700 }}>Unidad</label>
                <select value={unidadIdx} onChange={(e) => setUnidadIdx(Number(e.target.value))} style={inputStyle}>
                  {unidades.map((u, i) => <option key={u.unidad + i} value={i}>{u.etiqueta}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => setModo("precio")} style={chip(modo === "precio")}>Precio por {unidad?.unidad}</button>
              <button onClick={() => setModo("total")} style={chip(modo === "total")}>Total pagado</button>
            </div>
            {modo === "precio" ? (
              <input type="number" min="0" step="any" value={precio} onChange={(e) => setPrecio(e.target.value)} style={inputStyle} placeholder={`$ por ${unidad?.unidad}`} />
            ) : (
              <input type="number" min="0" step="any" value={totalTxt} onChange={(e) => setTotalTxt(e.target.value)} style={inputStyle} placeholder="$ total del ticket" />
            )}
            {calc && (
              <div style={{ background: "var(--h421-gray-50, rgba(0,0,0,0.04))", borderRadius: 8, padding: 10, fontSize: 13 }}>
                <div>Total de la compra: <strong style={{ fontSize: 16 }}>{dinero(calc.total)}</strong></div>
                <div>Precio: {dinero(calc.precioCaptura)} por {unidad?.unidad}</div>
                <div style={{ color: "var(--h421-gray-400)" }}>Entran al inventario {cant(calc.cantidadBase)} {insumo.unidadMedida} · costo {dinero(calc.costoUnitarioBase)} por {insumo.unidadMedida}</div>
              </div>
            )}
            {errorCalc && cantidad && (precio || totalTxt) && <p style={{ color: "var(--h421-red)", margin: 0, fontSize: 13 }}>{errorCalc}</p>}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <label style={{ fontSize: 13, fontWeight: 700 }}>Proveedor</label>
                <select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)} style={inputStyle}>
                  <option value="">Sin proveedor</option>
                  {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 13, fontWeight: 700 }}>Fecha de compra</label>
                <input type="date" value={dia} max={hoyLocal()} onChange={(e) => setDia(e.target.value)} style={inputStyle} />
              </div>
            </div>
            <input placeholder="Observaciones (opcional)" value={notas} onChange={(e) => setNotas(e.target.value)} style={inputStyle} />
          </>
        )}
        {error && <p style={{ color: "var(--h421-red)", margin: 0 }}>{error}</p>}
        <button disabled={!calc || guardando} onClick={guardar}
          style={{ background: "var(--h421-green)", color: "#fff", padding: "11px 16px", fontWeight: 800, opacity: !calc || guardando ? 0.5 : 1 }}>
          {guardando ? "Guardando…" : calc ? `Registrar compra de ${dinero(calc.total)}` : "Registrar compra"}
        </button>
      </div>
    </Modal>
  );
}

function ModalAnular({ compra, onCerrar, onAnulada }: { compra: Compra; onCerrar: () => void; onAnulada: () => void }) {
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function anular() {
    setGuardando(true);
    setError(null);
    try {
      await apiFetch(`/inventario/compras/${compra.id}/anular`, { method: "POST", body: JSON.stringify({ motivo }) });
      onAnulada();
    } catch (e: any) {
      setError(e?.message ?? "No se pudo anular.");
    } finally {
      setGuardando(false);
    }
  }
  return (
    <Modal titulo="Anular compra" onCerrar={onCerrar}>
      <p style={{ marginTop: 0 }}>
        {cant(compra.cantidadCaptura)} {compra.unidadCaptura} de <strong>{compra.insumo}</strong> por <strong>{dinero(compra.total)}</strong> ({fecha(compra.fechaCompra)}).
      </p>
      <p style={{ fontSize: 13, color: "var(--h421-gray-400)" }}>
        Se regresan {cant(compra.cantidadBase)} {compra.unidadBase} del inventario. La compra no se borra: queda marcada como anulada con tu nombre y el motivo. Si la cantidad o el precio estaban mal, anúlala y registra la correcta.
      </p>
      <input autoFocus placeholder="Motivo (obligatorio)" value={motivo} onChange={(e) => setMotivo(e.target.value)} style={{ ...inputStyle, marginBottom: 10 }} />
      {error && <p style={{ color: "var(--h421-red)" }}>{error}</p>}
      <button disabled={!motivo.trim() || guardando} onClick={anular}
        style={{ width: "100%", background: "var(--h421-red)", color: "#fff", padding: "10px 16px", fontWeight: 800, opacity: !motivo.trim() || guardando ? 0.5 : 1 }}>
        {guardando ? "Anulando…" : "Anular compra"}
      </button>
    </Modal>
  );
}
