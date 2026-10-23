"use client";

import { Fragment, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuthCrm } from "@/lib/authClient";
import { StatTile } from "@/components/StatTile";
import { BarChart } from "@/components/BarChart";
import { BotonesExportar } from "@/components/BotonesExportar";
import { ETIQUETA_TIPO_PAGO_DIDI, exportarDidiExcel, exportarDidiPdf, textoReglaDidi, type ReporteDidi as Reporte } from "@/lib/exportarVentas";

const dinero = (n: number) => `$${(n ?? 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const diaCorto = (d: string) => d.split("-").reverse().slice(0, 2).join("/");

/**
 * Reportes → DiDi: lo vendido en DiDi Food y la GANANCIA REAL para el negocio, ya descontadas
 * la comisión de DiDi (con su IVA) y las retenciones de los pedidos pagados en la app. La
 * fórmula vive en @hangar421/shared (comisionPlataforma.ts) y reproduce la hoja de precios de
 * DiDi del negocio. La comisión y los subsidios de DiDi se configuran aquí mismo.
 */
export function ReporteDidi({ sucursalId, sucursalNombre, desde, hasta }: { sucursalId: string; sucursalNombre?: string; desde: string; hasta: string }) {
  const { contexto } = useAuthCrm();
  const [datos, setDatos] = useState<Reporte | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verConfig, setVerConfig] = useState(false);
  const [verPedidos, setVerPedidos] = useState(false);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    setCargando(true);
    setError(null);
    const q = new URLSearchParams({ desde, hasta });
    if (sucursalId) q.set("sucursalId", sucursalId);
    apiFetch<Reporte>(`/reportes/didi?${q}`)
      .then(setDatos)
      .catch((e) => setError(e?.message ?? "No se pudo cargar el reporte de DiDi."))
      .finally(() => setCargando(false));
  }, [sucursalId, desde, hasta, recarga]);

  const s = datos?.resumen;
  const sucursal = sucursalNombre ?? "Todas las sucursales";
  const puedeConfigurar = contexto?.rol === "ADMIN_CORPORATIVO";

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div style={{ fontSize: 13, color: "var(--h421-gray-400)" }}>
          {datos ? textoReglaDidi(datos.config) : "Ventas cobradas en el grupo DiDi"}
          {" · "}
          <button onClick={() => setVerConfig((v) => !v)} style={{ background: "transparent", border: 0, padding: 0, color: "var(--h421-blue)", textDecoration: "underline", fontSize: 13 }}>
            {verConfig ? "Ocultar configuración" : "Configurar comisión y subsidios"}
          </button>
        </div>
        {datos && (
          <BotonesExportar
            deshabilitado={cargando || datos.resumen.tickets === 0}
            onPdf={() => exportarDidiPdf(datos, sucursal)}
            onExcel={() => exportarDidiExcel(datos, sucursal)}
          />
        )}
      </div>

      {verConfig && datos && (
        <ConfigDidi reporte={datos} editable={puedeConfigurar} onGuardado={() => setRecarga((n) => n + 1)} />
      )}

      {cargando && <p style={{ color: "var(--h421-gray-400)" }}>Cargando…</p>}
      {error && <p style={{ color: "var(--h421-red)" }}>{error}</p>}

      {s && (
        <>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 12 }}>
            <StatTile etiqueta="🛵 Vendido en DiDi (pagado por clientes)" valor={dinero(s.pagadoCliente)} acento="var(--h421-amber)" />
            <StatTile etiqueta="Pedidos" valor={String(s.tickets)} acento="var(--h421-blue)" />
            <StatTile etiqueta="Comisión DiDi + retenciones" valor={`−${dinero(s.comision + s.retencion)}`} acento="var(--h421-red)" />
            <StatTile etiqueta="💰 Ganancia real para el negocio" valor={dinero(s.neto)} acento="var(--h421-green)" />
            <StatTile etiqueta="% que te queda" valor={`${s.porcentajeNeto.toFixed(1)}%`} acento="var(--h421-green)" />
          </div>

          {s.tickets === 0 ? (
            <div className="card" style={{ marginTop: 16 }}>
              <p style={{ margin: 0, color: "var(--h421-gray-400)" }}>No hay ventas de DiDi cobradas en este rango.</p>
            </div>
          ) : (
            <>
              <div className="h421-grid-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 16, marginTop: 20 }}>
                <div className="card">
                  <h3 style={{ marginTop: 0 }}>Cómo se llega a la ganancia real</h3>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                    <tbody>
                      <Fila texto="Precio de lista en DiDi" valor={dinero(s.bruto)} />
                      <Fila texto="− Promociones (las paga el negocio)" valor={`−${dinero(s.descuento)}`} gris />
                      <Fila texto="= Pagado por los clientes" valor={dinero(s.pagadoCliente)} fuerte />
                      <Fila texto="+ Subsidio de DiDi en promociones" valor={dinero(s.subsidio)} gris />
                      <Fila texto={`− Comisión de DiDi (${datos!.config.comisionPct}% + IVA)`} valor={`−${dinero(s.comision)}`} rojo />
                      <Fila texto={`− Retenciones (${datos!.config.retencionPct}%, solo pagos en la app)`} valor={`−${dinero(s.retencion)}`} rojo />
                      <tr style={{ background: "rgba(22,163,74,0.12)" }}>
                        <td style={{ padding: "10px 8px", fontWeight: 800 }}>= Ganancia real para el negocio</td>
                        <td style={{ padding: "10px 8px", textAlign: "right", fontWeight: 800, fontSize: 18, color: "var(--h421-green)" }}>{dinero(s.neto)}</td>
                      </tr>
                    </tbody>
                  </table>
                  <p style={{ fontSize: 12, color: "var(--h421-gray-400)", marginBottom: 0 }}>
                    La ganancia es lo que DiDi le paga al negocio por estos pedidos. No descuenta el costo de los insumos.
                  </p>
                </div>

                <div className="card">
                  <h3 style={{ marginTop: 0 }}>Por tipo de pago</h3>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ color: "var(--h421-gray-400)", fontSize: 12, textAlign: "right" }}>
                        <th style={{ textAlign: "left", padding: 6 }}>Tipo</th><th style={{ padding: 6 }}>Pedidos</th><th style={{ padding: 6 }}>Pagado</th><th style={{ padding: 6 }}>Comisión</th><th style={{ padding: 6 }}>Ganancia</th><th style={{ padding: 6 }}>%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {datos!.porTipoPago.map((t) => (
                        <tr key={t.tipo} style={{ borderTop: "1px solid var(--h421-gray-200)", textAlign: "right" }}>
                          <td style={{ textAlign: "left", padding: 6 }}>{ETIQUETA_TIPO_PAGO_DIDI[t.tipo] ?? t.tipo}</td>
                          <td style={{ padding: 6 }}>{t.tickets}</td>
                          <td style={{ padding: 6 }}>{dinero(t.pagadoCliente)}</td>
                          <td style={{ padding: 6, color: "var(--h421-red-texto)" }}>−{dinero(t.comision + t.retencion)}</td>
                          <td style={{ padding: 6, fontWeight: 700 }}>{dinero(t.neto)}</td>
                          <td style={{ padding: 6 }}>{t.porcentajeNeto.toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <h3 style={{ marginBottom: 6 }}>Ganancia real por día</h3>
                  <BarChart data={datos!.porDia.map((d) => ({ etiqueta: diaCorto(d.dia), valor: d.neto }))} alto={150} formatoValor={(v) => `$${v.toFixed(0)}`} />
                </div>
              </div>

              <div className="card h421-tabla-wrap" style={{ marginTop: 16, overflowX: "auto" }}>
                <h3 style={{ marginTop: 0 }}>Por producto <span style={{ fontSize: 13, color: "var(--h421-gray-400)", fontWeight: 400 }}>· de mayor a menor ganancia</span></h3>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: "var(--h421-gray-400)", fontSize: 12, textAlign: "right" }}>
                      <th style={{ textAlign: "left", padding: 6 }}>Producto</th><th style={{ padding: 6 }}>Unidades</th><th style={{ padding: 6 }}>Precio de lista</th><th style={{ padding: 6 }}>Pagado cliente</th><th style={{ padding: 6 }}>Subsidio DiDi</th><th style={{ padding: 6 }}>Ganancia real</th><th style={{ padding: 6 }}>Por unidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datos!.porProducto.map((p) => (
                      <tr key={p.productoId} style={{ borderTop: "1px solid var(--h421-gray-200)", textAlign: "right" }}>
                        <td style={{ textAlign: "left", padding: 6, fontWeight: 600 }}>{p.nombre}</td>
                        <td style={{ padding: 6 }}>{p.unidades}</td>
                        <td style={{ padding: 6, color: "var(--h421-gray-400)" }}>{dinero(p.bruto)}</td>
                        <td style={{ padding: 6 }}>{dinero(p.pagadoCliente)}</td>
                        <td style={{ padding: 6 }}>{p.subsidio > 0 ? dinero(p.subsidio) : "—"}</td>
                        <td style={{ padding: 6, fontWeight: 700, color: "var(--h421-green)" }}>{dinero(p.neto)}</td>
                        <td style={{ padding: 6 }}>{dinero(p.netoPorUnidad)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="card h421-tabla-wrap" style={{ marginTop: 16, overflowX: "auto" }}>
                <button onClick={() => setVerPedidos((v) => !v)} style={{ background: "transparent", border: 0, padding: 0, fontSize: 16, fontWeight: 700, color: "inherit" }}>
                  {verPedidos ? "▾" : "▸"} Pedidos de DiDi ({datos!.tickets.length})
                </button>
                {verPedidos && (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginTop: 10 }}>
                    <thead>
                      <tr style={{ color: "var(--h421-gray-400)", textAlign: "right" }}>
                        <th style={{ textAlign: "left", padding: 5 }}>Folio</th><th style={{ textAlign: "left", padding: 5 }}>Fecha</th>
                        {!sucursalId && <th style={{ textAlign: "left", padding: 5 }}>Sucursal</th>}
                        <th style={{ textAlign: "left", padding: 5 }}>Pago</th><th style={{ textAlign: "left", padding: 5 }}>Productos</th>
                        <th style={{ padding: 5 }}>Lista</th><th style={{ padding: 5 }}>Promo</th><th style={{ padding: 5 }}>Cliente</th><th style={{ padding: 5 }}>Subsidio</th><th style={{ padding: 5 }}>Comisión</th><th style={{ padding: 5 }}>Retención</th><th style={{ padding: 5 }}>Ganancia</th>
                      </tr>
                    </thead>
                    <tbody>
                      {datos!.tickets.map((t) => (
                        <Fragment key={t.id}>
                          <tr style={{ borderTop: "1px solid var(--h421-gray-200)", textAlign: "right" }}>
                            <td style={{ textAlign: "left", padding: 5 }}>{t.folio}</td>
                            <td style={{ textAlign: "left", padding: 5, whiteSpace: "nowrap" }}>{new Date(t.fecha).toLocaleString("es-MX", { timeZone: datos!.rango.zona, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                            {!sucursalId && <td style={{ textAlign: "left", padding: 5 }}>{t.sucursal}</td>}
                            <td style={{ textAlign: "left", padding: 5 }}>{ETIQUETA_TIPO_PAGO_DIDI[t.tipoPago] ?? t.tipoPago}</td>
                            <td style={{ textAlign: "left", padding: 5 }}>{t.productos}</td>
                            <td style={{ padding: 5, color: "var(--h421-gray-400)" }}>{dinero(t.bruto)}</td>
                            <td style={{ padding: 5 }}>{t.descuento > 0 ? `−${dinero(t.descuento)}` : "—"}</td>
                            <td style={{ padding: 5 }}>{dinero(t.pagadoCliente)}</td>
                            <td style={{ padding: 5 }}>{t.subsidio > 0 ? dinero(t.subsidio) : "—"}</td>
                            <td style={{ padding: 5, color: "var(--h421-red-texto)" }}>−{dinero(t.comision)}</td>
                            <td style={{ padding: 5, color: "var(--h421-red-texto)" }}>{t.retencion > 0 ? `−${dinero(t.retencion)}` : "—"}</td>
                            <td style={{ padding: 5, fontWeight: 700 }}>{dinero(t.neto)}</td>
                          </tr>
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Fila({ texto, valor, gris, rojo, fuerte }: { texto: string; valor: string; gris?: boolean; rojo?: boolean; fuerte?: boolean }) {
  const color = rojo ? "var(--h421-red-texto)" : gris ? "var(--h421-gray-400)" : "inherit";
  return (
    <tr style={{ borderBottom: "1px solid var(--h421-gray-200)" }}>
      <td style={{ padding: "8px", color, fontWeight: fuerte ? 700 : 400 }}>{texto}</td>
      <td style={{ padding: "8px", textAlign: "right", color, fontWeight: fuerte ? 700 : 600 }}>{valor}</td>
    </tr>
  );
}

/**
 * Comisión pactada con DiDi y subsidios de DiDi por producto. El subsidio es lo que DiDi pone de
 * su bolsa en una promoción (en la hoja de precios: "Subsidio DiDi"); la venta solo registra lo
 * que pagó el cliente, así que sin capturarlo la ganancia de esas promociones saldría baja.
 */
function ConfigDidi({ reporte, editable, onGuardado }: { reporte: Reporte; editable: boolean; onGuardado: () => void }) {
  const [cfg, setCfg] = useState({ ...reporte.config });
  const productos = new Map<string, string>();
  for (const p of reporte.porProducto) productos.set(p.productoId, p.nombre);
  for (const s of reporte.subsidios) productos.set(s.productoId, s.nombre);
  const [subsidios, setSubsidios] = useState<Record<string, string>>(() => Object.fromEntries(reporte.subsidios.map((s) => [s.productoId, String(s.monto)])));
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);

  async function guardar() {
    setGuardando(true);
    setMensaje(null);
    try {
      await apiFetch("/reportes/didi/config", {
        method: "PUT",
        body: JSON.stringify({
          ...cfg,
          subsidios: Object.entries(subsidios).map(([productoId, v]) => ({ productoId, monto: Number(v.replace(",", ".")) || 0 })),
        }),
      });
      setMensaje({ ok: true, texto: "Guardado. El reporte ya usa estos valores." });
      onGuardado();
    } catch (e: any) {
      setMensaje({ ok: false, texto: e?.message ?? "No se pudo guardar." });
    } finally {
      setGuardando(false);
    }
  }

  const campo = (clave: keyof typeof cfg, texto: string, ayuda: string) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 150 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--h421-gray-400)" }}>{texto}</span>
      <input type="number" step="0.1" min={0} max={100} value={cfg[clave]} disabled={!editable}
        onChange={(e) => setCfg((c) => ({ ...c, [clave]: Number(e.target.value) }))}
        style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--h421-gray-200)", width: 120 }} />
      <span style={{ fontSize: 11, color: "var(--h421-gray-400)" }}>{ayuda}</span>
    </label>
  );

  return (
    <div className="card" style={{ marginTop: 12, borderLeft: "4px solid var(--h421-amber)" }}>
      <strong>Comisión de DiDi</strong>
      {!editable && <span style={{ fontSize: 12, color: "var(--h421-gray-400)" }}> · solo un administrador corporativo puede cambiarla</span>}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 10 }}>
        {campo("comisionPct", "Comisión %", "Sobre lo pagado + subsidio")}
        {campo("ivaComisionPct", "IVA de la comisión %", "DiDi cobra IVA sobre su comisión")}
        {campo("retencionPct", "Retenciones %", "ISR + IVA, solo pagos en la app, sobre el precio sin IVA")}
        {campo("ivaVentaPct", "IVA del precio %", "Para sacar el precio sin IVA")}
      </div>
      <p style={{ fontSize: 12, color: "var(--h421-gray-400)" }}>
        Con 30% + IVA 16% y 10.5% de retención salen los mismos montos de la hoja de precios: $100 en efectivo dejan $65.20 y pagados en la app $56.15.
      </p>

      <strong>Subsidio de DiDi por producto</strong>
      <p style={{ fontSize: 12, color: "var(--h421-gray-400)", margin: "4px 0 8px" }}>
        Pesos por unidad que DiDi pone en sus promociones (ej. Latte caliente a $49: DiDi pone $50). Déjalo vacío si el producto no tiene subsidio.
      </p>
      {productos.size === 0 ? (
        <p style={{ fontSize: 13, color: "var(--h421-gray-400)" }}>Aparecerán aquí los productos vendidos en DiDi en el rango elegido.</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 8 }}>
          {[...productos.entries()].sort((a, b) => a[1].localeCompare(b[1], "es")).map(([id, nombre]) => (
            <label key={id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 8px", border: "1px solid var(--h421-gray-200)", borderRadius: 8 }}>
              <span style={{ fontSize: 13 }}>{nombre}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                $<input inputMode="decimal" value={subsidios[id] ?? ""} placeholder="0" disabled={!editable}
                  onChange={(e) => setSubsidios((s) => ({ ...s, [id]: e.target.value.replace(/[^0-9.,]/g, "") }))}
                  style={{ width: 64, padding: "5px 6px", borderRadius: 6, border: "1px solid var(--h421-gray-200)", textAlign: "right" }} />
              </span>
            </label>
          ))}
        </div>
      )}
      {editable && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12 }}>
          <button onClick={guardar} disabled={guardando} style={{ padding: "9px 18px", background: "var(--h421-navy)", color: "#fff" }}>
            {guardando ? "Guardando…" : "Guardar configuración"}
          </button>
          {mensaje && <span style={{ fontSize: 13, color: mensaje.ok ? "var(--h421-green)" : "var(--h421-red)" }}>{mensaje.texto}</span>}
        </div>
      )}
    </div>
  );
}
