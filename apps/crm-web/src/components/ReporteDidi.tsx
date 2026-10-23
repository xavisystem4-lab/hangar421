"use client";

import { Fragment, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuthCrm } from "@/lib/authClient";
import { StatTile } from "@/components/StatTile";
import { BarChart } from "@/components/BarChart";
import { BotonesExportar } from "@/components/BotonesExportar";
import { ETIQUETA_TIPO_PAGO_DIDI, exportarDidiExcel, exportarDidiPdf, horaPico, masYMenosVendidos, metodoDidi, textoHora, textoReglaDidi, type ReporteDidi as Reporte } from "@/lib/exportarVentas";

const dinero = (n: number) => `$${(n ?? 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const diaCorto = (d: string) => d.split("-").reverse().slice(0, 2).join("/");

/**
 * Reportes → DiDi: lo vendido en DiDi Food y la GANANCIA REAL para el negocio, ya descontada
 * la comisión de DiDi sobre el total: 43 % si el cliente pagó con tarjeta / en la app y 35 % si
 * pagó en efectivo. La fórmula vive en @hangar421/shared (comisionPlataforma.ts). Los dos
 * porcentajes y los subsidios de DiDi se configuran aquí mismo.
 */
export function ReporteDidi({ sucursalId, sucursalNombre, desde, hasta }: { sucursalId: string; sucursalNombre?: string; desde: string; hasta: string }) {
  const { contexto } = useAuthCrm();
  const [datos, setDatos] = useState<Reporte | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verConfig, setVerConfig] = useState(false);
  const [verPedidos, setVerPedidos] = useState(false);
  /** Método de pago elegido: filtra los pedidos y enseña qué productos se cobraron con él. */
  const [metodoSel, setMetodoSel] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);
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
  const pedidosVisibles = (datos?.tickets ?? []).filter((t) => !metodoSel || (t.metodos ?? []).includes(metodoSel));

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
            <StatTile etiqueta="Comisión DiDi" valor={`−${dinero(s.comision)}`} acento="var(--h421-red)" />
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
                  <h3 style={{ marginTop: 0 }}>Detalle como lo da DiDi</h3>
                  <DetalleEstiloDidi
                    sinPromocion={s.bruto}
                    promocion={s.descuento}
                    despuesDescuento={s.pagadoCliente}
                    subsidio={s.subsidio}
                    cargos={s.comision}
                    tasa={`${datos!.config.comisionEnLineaPct}% tarjeta / ${datos!.config.comisionEfectivoPct}% efectivo`}
                    ganancia={s.neto}
                    grande
                  />
                  <p style={{ fontSize: 12, color: "var(--h421-gray-400)", marginBottom: 0 }}>
                    La ganancia es lo que DiDi le paga al negocio por estos pedidos. No descuenta el costo de los insumos.
                  </p>
                </div>

                <div className="card">
                  <h3 style={{ marginTop: 0, marginBottom: 4 }}>Cómo pagaron los clientes</h3>
                  <p style={{ fontSize: 12, color: "var(--h421-gray-400)", margin: "0 0 8px" }}>Toca un método para ver qué productos se cobraron con él.</p>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ color: "var(--h421-gray-400)", fontSize: 12, textAlign: "right" }}>
                        <th style={{ textAlign: "left", padding: 6 }}>Método</th><th style={{ padding: 6 }}>Transacciones</th><th style={{ padding: 6 }}>Cobrado</th><th style={{ padding: 6 }}>Comisión</th><th style={{ padding: 6 }}>Ganancia</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(datos!.porMetodo ?? []).map((m) => {
                        const activo = metodoSel === m.metodo;
                        return (
                          <tr key={m.metodo} onClick={() => { setMetodoSel(activo ? null : m.metodo); setVerPedidos(true); }}
                            style={{ borderTop: "1px solid var(--h421-gray-200)", textAlign: "right", cursor: "pointer", background: activo ? "rgba(255,106,19,0.14)" : undefined }}>
                            <td style={{ textAlign: "left", padding: 6, fontWeight: 700 }}>{activo ? "▾" : "▸"} {metodoDidi(m.metodo)}</td>
                            <td style={{ padding: 6 }}>{m.transacciones}</td>
                            <td style={{ padding: 6, fontWeight: 700 }}>{dinero(m.pagadoCliente)}</td>
                            <td style={{ padding: 6, color: "var(--h421-red-texto)" }}>−{dinero(m.comision)} <span style={{ fontSize: 11 }}>({m.comisionPct}%)</span></td>
                            <td style={{ padding: 6, fontWeight: 700, color: "var(--h421-green)" }}>{dinero(m.neto)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <h3 style={{ marginBottom: 6 }}>Ganancia real por día</h3>
                  <BarChart data={datos!.porDia.map((d) => ({ etiqueta: diaCorto(d.dia), valor: d.neto }))} alto={150} formatoValor={(v) => `$${v.toFixed(0)}`} />
                </div>
              </div>

              {metodoSel && <ProductosCobrados reporte={datos!} metodo={metodoSel} onCerrar={() => setMetodoSel(null)} />}

              <HorasYProductos reporte={datos!} />

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
                  {verPedidos ? "▾" : "▸"} Pedidos de DiDi ({pedidosVisibles.length}){metodoSel ? ` · cobrados con ${metodoDidi(metodoSel)}` : ""}
                </button>
                {metodoSel && (
                  <button onClick={() => setMetodoSel(null)} style={{ marginLeft: 10, fontSize: 12, padding: "4px 10px", background: "transparent", border: "1px solid var(--h421-gray-200)" }}>Ver todos ✕</button>
                )}
                <p style={{ fontSize: 12, color: "var(--h421-gray-400)", margin: "4px 0 0" }}>Toca un pedido para ver sus productos.</p>
                {verPedidos && (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginTop: 10 }}>
                    <thead>
                      <tr style={{ color: "var(--h421-gray-400)", textAlign: "right" }}>
                        <th style={{ textAlign: "left", padding: 5 }}>Folio</th><th style={{ textAlign: "left", padding: 5 }}>Fecha</th>
                        {!sucursalId && <th style={{ textAlign: "left", padding: 5 }}>Sucursal</th>}
                        <th style={{ textAlign: "left", padding: 5 }}>Pago</th><th style={{ textAlign: "left", padding: 5 }}>Productos</th>
                        <th style={{ padding: 5 }}>Sin promoción</th><th style={{ padding: 5 }}>Promoción tienda</th><th style={{ padding: 5 }}>Después del desc.</th><th style={{ padding: 5 }}>Subsidio</th><th style={{ padding: 5 }}>Cargos DiDi</th><th style={{ padding: 5 }}>Ganancia por pedido</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pedidosVisibles.map((t) => (
                        <Fragment key={t.id}>
                          <tr onClick={() => setAbierto(abierto === t.id ? null : t.id)} style={{ borderTop: "1px solid var(--h421-gray-200)", textAlign: "right", cursor: "pointer" }}>
                            <td style={{ textAlign: "left", padding: 5 }}>{abierto === t.id ? "▾" : "▸"} {t.folio}</td>
                            <td style={{ textAlign: "left", padding: 5, whiteSpace: "nowrap" }}>{new Date(t.fecha).toLocaleString("es-MX", { timeZone: datos!.rango.zona, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                            {!sucursalId && <td style={{ textAlign: "left", padding: 5 }}>{t.sucursal}</td>}
                            <td style={{ textAlign: "left", padding: 5 }}>{t.metodos?.length ? t.metodos.map(metodoDidi).join(" + ") : ETIQUETA_TIPO_PAGO_DIDI[t.tipoPago] ?? t.tipoPago}</td>
                            <td style={{ textAlign: "left", padding: 5 }}>{t.productos}</td>
                            <td style={{ padding: 5, color: "var(--h421-gray-400)" }}>{dinero(t.bruto)}</td>
                            <td style={{ padding: 5 }}>{t.descuento > 0 ? `−${dinero(t.descuento)}` : "—"}</td>
                            <td style={{ padding: 5 }}>{dinero(t.pagadoCliente)}</td>
                            <td style={{ padding: 5 }}>{t.subsidio > 0 ? dinero(t.subsidio) : "—"}</td>
                            <td style={{ padding: 5, color: "var(--h421-red-texto)" }}>−{dinero(t.comision)}</td>
                            <td style={{ padding: 5, fontWeight: 700 }}>{dinero(t.neto)}</td>
                          </tr>
                          {abierto === t.id && (
                            <tr>
                              <td colSpan={sucursalId ? 10 : 11} style={{ padding: "8px 12px 14px", background: "var(--h421-gray-50)" }}>
                                <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 1fr) minmax(280px, 1fr)", gap: 20 }}>
                                <div>
                                <strong style={{ fontSize: 13 }}>Pedido {t.folio} · {new Date(t.fecha).toLocaleString("es-MX", { timeZone: datos!.rango.zona, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</strong>
                                <table style={{ borderCollapse: "collapse", fontSize: 13, marginTop: 6, minWidth: 320 }}>
                                  <tbody>
                                    {(t.items ?? []).map((i, k) => (
                                      <tr key={k}>
                                        <td style={{ padding: "2px 10px 2px 0" }}>{i.cantidad}×</td>
                                        <td style={{ padding: "2px 16px 2px 0" }}>{i.nombre}</td>
                                        <td style={{ padding: "2px 0", textAlign: "right" }}>{dinero(i.importe)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                                {(t.pagos?.length ?? 0) > 0 && (
                                  <div style={{ fontSize: 12, marginTop: 6, color: "var(--h421-gray-400)" }}>
                                    Pago: {t.pagos!.map((x) => `${metodoDidi(x.metodo)} ${dinero(x.monto)}`).join(" + ")}
                                  </div>
                                )}
                                </div>
                                <DetalleEstiloDidi
                                  sinPromocion={t.bruto}
                                  promocion={t.descuento}
                                  despuesDescuento={t.pagadoCliente}
                                  subsidio={t.subsidio}
                                  cargos={t.comision}
                                  tasa={t.tipoPago === "EFECTIVO" ? `${datos!.config.comisionEfectivoPct}%` : t.tipoPago === "EN_LINEA" ? `${datos!.config.comisionEnLineaPct}%` : "mixta"}
                                  ganancia={t.neto}
                                />
                                </div>
                              </td>
                            </tr>
                          )}
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
        {campo("comisionEnLineaPct", "Comisión con tarjeta / app %", "El cliente pagó con tarjeta o en la app")}
        {campo("comisionEfectivoPct", "Comisión en efectivo %", "El cliente pagó en efectivo")}
      </div>
      <p style={{ fontSize: 12, color: "var(--h421-gray-400)" }}>
        Se resta de la cuenta total. Con 43% y 35%: un pedido de $100 con tarjeta deja $57 y en efectivo $65.
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

/**
 * A qué hora se vende más en DiDi (gráfica por hora, la hora pico resaltada) y qué productos se
 * venden más y menos, por unidades.
 */
function HorasYProductos({ reporte }: { reporte: Reporte }) {
  const horas = reporte.porHora ?? [];
  const pico = horaPico(reporte);
  const { mas, menos } = masYMenosVendidos(reporte);
  const maxMas = Math.max(1, ...mas.map((p) => p.unidades));
  const lista = (titulo: string, color: string, filas: Reporte["porProducto"]) => (
    <div className="card" style={{ margin: 0 }}>
      <h3 style={{ marginTop: 0, color }}>{titulo}</h3>
      {filas.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--h421-gray-400)", margin: 0 }}>Hacen falta más productos vendidos para comparar.</p>
      ) : (
        filas.map((p, i) => (
          <div key={p.productoId} style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, gap: 8 }}>
              <span><span style={{ color: "var(--h421-gray-400)" }}>{i + 1}.</span> <strong>{p.nombre}</strong></span>
              <span style={{ whiteSpace: "nowrap" }}>{p.unidades} u · {dinero(p.neto)}</span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: "var(--h421-gray-200)", marginTop: 3, overflow: "hidden" }}>
              <div style={{ height: 6, width: `${Math.max(4, (p.unidades / maxMas) * 100)}%`, background: color }} />
            </div>
          </div>
        ))
      )}
    </div>
  );
  return (
    <div className="h421-grid-2col" style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr", gap: 16, marginTop: 16 }}>
      <div className="card" style={{ margin: 0 }}>
        <h3 style={{ marginTop: 0, marginBottom: 4 }}>Ventas por hora</h3>
        {pico && (
          <p style={{ margin: "0 0 8px", fontSize: 13 }}>
            ⏰ Hora pico: <strong style={{ color: "#FF6A13" }}>{textoHora(pico.hora)}</strong> · {pico.tickets} pedido{pico.tickets === 1 ? "" : "s"} · {dinero(pico.pagadoCliente)}
          </p>
        )}
        <BarChart data={horas.map((h) => ({ etiqueta: `${h.hora} h`, valor: h.pagadoCliente }))} alto={170} formatoValor={(v) => `$${v.toFixed(0)}`} />
        <p style={{ fontSize: 11, color: "var(--h421-gray-400)", margin: "6px 0 0" }}>Lo que pagaron los clientes en cada hora (hora de la sucursal).</p>
      </div>
      {lista("🔥 Más vendidos", "var(--h421-green)", mas)}
      {lista("🐢 Menos vendidos", "var(--h421-red)", menos)}
    </div>
  );
}

/** Qué productos se cobraron con un método de pago (pedidos que llevan ese método). */
function ProductosCobrados({ reporte, metodo, onCerrar }: { reporte: Reporte; metodo: string; onCerrar: () => void }) {
  const pedidos = reporte.tickets.filter((t) => (t.metodos ?? []).includes(metodo));
  const productos = new Map<string, { nombre: string; unidades: number; importe: number }>();
  for (const t of pedidos) {
    for (const i of t.items ?? []) {
      const g = productos.get(i.productoId) ?? { nombre: i.nombre, unidades: 0, importe: 0 };
      g.unidades += i.cantidad;
      g.importe += i.importe;
      productos.set(i.productoId, g);
    }
  }
  const filas = [...productos.values()].sort((a, b) => b.unidades - a.unidades);
  const m = reporte.porMetodo?.find((x) => x.metodo === metodo);
  return (
    <div className="card" style={{ marginTop: 16, borderLeft: "4px solid #FF6A13" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ margin: 0 }}>Cobrado con {metodoDidi(metodo)}: qué se vendió</h3>
        <button onClick={onCerrar} style={{ fontSize: 12, padding: "4px 10px", background: "transparent", border: "1px solid var(--h421-gray-200)" }}>Cerrar ✕</button>
      </div>
      {m && (
        <p style={{ fontSize: 13, margin: "6px 0 10px" }}>
          {pedidos.length} pedido{pedidos.length === 1 ? "" : "s"} · cobrado <strong>{dinero(m.pagadoCliente)}</strong> · comisión {m.comisionPct}% −{dinero(m.comision)} · ganancia <strong style={{ color: "var(--h421-green)" }}>{dinero(m.neto)}</strong>
        </p>
      )}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ color: "var(--h421-gray-400)", fontSize: 12, textAlign: "right" }}>
            <th style={{ textAlign: "left", padding: 6 }}>Producto</th><th style={{ padding: 6 }}>Unidades</th><th style={{ padding: 6 }}>Importe (precio de lista)</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.nombre} style={{ borderTop: "1px solid var(--h421-gray-200)", textAlign: "right" }}>
              <td style={{ textAlign: "left", padding: 6, fontWeight: 600 }}>{f.nombre}</td>
              <td style={{ padding: 6 }}>{f.unidades}</td>
              <td style={{ padding: 6 }}>{dinero(f.importe)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ fontSize: 11, color: "var(--h421-gray-400)", margin: "6px 0 0" }}>Un pedido pagado mitad y mitad aparece en los dos métodos. Abajo están los pedidos uno por uno.</p>
    </div>
  );
}

/**
 * Desglose con los mismos conceptos que el "Detalle del pedido" de DiDi: precio sin promoción →
 * costo de promoción de la tienda → ganancias después del descuento → cargos de DiDi (comisión y
 * distribución) → ganancias por pedido / monto del recibo.
 */
function DetalleEstiloDidi({ sinPromocion, promocion, despuesDescuento, subsidio, cargos, tasa, ganancia, grande }: {
  sinPromocion: number; promocion: number; despuesDescuento: number; subsidio: number; cargos: number; tasa: string; ganancia: number; grande?: boolean;
}) {
  const fs = grande ? 14 : 13;
  const fila = (texto: string, valor: string, o: { fuerte?: boolean; sub?: boolean; rojo?: boolean } = {}) => (
    <tr>
      <td style={{ padding: o.sub ? "2px 8px 6px 22px" : "7px 8px", fontSize: o.sub ? fs - 1 : fs, fontWeight: o.fuerte ? 800 : 400, color: o.sub ? "var(--h421-gray-400)" : "inherit" }}>{texto}</td>
      <td style={{ padding: o.sub ? "2px 8px 6px" : "7px 8px", textAlign: "right", fontSize: o.sub ? fs - 1 : fs, fontWeight: o.fuerte ? 800 : 600, color: o.rojo ? "var(--h421-red-texto)" : o.sub ? "var(--h421-gray-400)" : "inherit", whiteSpace: "nowrap" }}>{valor}</td>
    </tr>
  );
  const sep = <tr><td colSpan={2} style={{ borderTop: "1px solid var(--h421-gray-200)", padding: 0 }} /></tr>;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <tbody>
        {fila("Precio total del producto sin promoción", `MX${dinero(sinPromocion)}`, { fuerte: true })}
        {fila("Costo de promoción de productos de la tienda", `-MX${dinero(promocion)}`, { fuerte: true, rojo: promocion > 0 })}
        {promocion > 0 && fila("Inversión de promoción de productos de la tienda", `-MX${dinero(promocion)}`, { sub: true })}
        {fila("Ganancias totales después del descuento", `MX${dinero(despuesDescuento)}`, { fuerte: true })}
        {subsidio > 0 && fila("Subsidio de DiDi en la promoción", `MX${dinero(subsidio)}`, { sub: true })}
        {sep}
        {fila("Cargos de DiDi", `-MX${dinero(cargos)}`, { fuerte: true, rojo: true })}
        {fila(`Comisión y distribución (Tasa del servicio ${tasa})`, `-MX${dinero(cargos)}`, { sub: true })}
        {sep}
        <tr style={{ background: "rgba(22,163,74,0.12)" }}>
          <td style={{ padding: "9px 8px", fontWeight: 800, fontSize: grande ? 15 : fs }}>Ganancias por pedido</td>
          <td style={{ padding: "9px 8px", textAlign: "right", fontWeight: 800, fontSize: grande ? 18 : fs + 1, color: "var(--h421-green)" }}>MX{dinero(ganancia)}</td>
        </tr>
        {fila("Monto del recibo", `MX${dinero(ganancia)}`, { fuerte: true })}
      </tbody>
    </table>
  );
}
