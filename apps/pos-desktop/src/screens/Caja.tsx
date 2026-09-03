import { useEffect, useState, type CSSProperties, type KeyboardEvent } from "react";
import { apiFetch } from "../api/http";
import { useAuthStore } from "../store/authStore";

interface CajaDto { id: string; nombre: string }
interface TurnoDto { id: string; montoInicial: string; fechaApertura: string }
interface MovimientoDto { id: string; tipo: "INGRESO" | "EGRESO"; monto: string; motivo: string; createdAt: string }
interface ResumenDto {
  turno: TurnoDto & { montoFinalDeclarado: string | null; montoFinalSistema: string | null; diferencia: string | null; estado: string };
  pagosPorMetodo: { metodo: string; _sum: { monto: string | null }; _count: number }[];
  movimientos: MovimientoDto[];
  totalIngresos: number;
  totalEgresos: number;
  montoEsperado: number;
}

const ETIQUETA_METODO: Record<string, string> = {
  EFECTIVO: "Efectivo", TARJETA: "Tarjeta", TRANSFERENCIA: "Transferencia", QR: "QR", OTRO: "Otro",
};

// Denominaciones vigentes de billetes/monedas MXN y billetes USD — el desglose es lo que se
// cuenta físicamente al hacer el corte; el dólar se muestra aparte (informativo, no se suma
// al efectivo MXN esperado del sistema salvo que se cambie a pesos en caja aparte).
const BILLETES_MXN = [1000, 500, 200, 100, 50, 20];
const MONEDAS_MXN = [20, 10, 5, 2, 1, 0.5];
const BILLETES_USD = [100, 50, 20, 10, 5, 1];

type Conteo = Record<number, number>;
function totalConteo(c: Conteo): number {
  return Object.entries(c).reduce((s, [denom, cant]) => s + Number(denom) * (cant || 0), 0);
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Enter/flecha abajo pasa al siguiente campo de denominación, flecha arriba al anterior —
 *  como capturar en Excel, para contar efectivo rápido sin tocar el mouse. Los campos deben
 *  vivir dentro de un contenedor con `data-desglose-container` y llevar `data-denom-input`.
 *  Arriba/abajo saltan al campo de la fila anterior/siguiente que quede más cerca en horizontal
 *  (posición real en pantalla, no solo el siguiente del arreglo — si no fuera así, "abajo" en el
 *  primer campo de una fila caería en el segundo campo de la MISMA fila). Izquierda/derecha (y
 *  Enter, que se comporta como "derecha"/"siguiente") sí usan el orden del arreglo porque dentro
 *  de una fila ese orden ya es el orden visual de izquierda a derecha. */
function manejarTeclaDesglose(e: KeyboardEvent<HTMLInputElement>) {
  const teclas = ["Enter", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"];
  if (!teclas.includes(e.key)) return;
  const contenedor = e.currentTarget.closest("[data-desglose-container]");
  if (!contenedor) return;
  const inputs = Array.from(contenedor.querySelectorAll<HTMLInputElement>("input[data-denom-input]"));
  const idx = inputs.indexOf(e.currentTarget);
  if (idx === -1) return;

  let destino: HTMLInputElement | undefined;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    destino = vecinoEnFila(inputs, e.currentTarget, e.key === "ArrowDown" ? 1 : -1) ?? inputs[idx + (e.key === "ArrowDown" ? 1 : -1)];
  } else {
    destino = inputs[idx + (e.key === "ArrowLeft" ? -1 : 1)];
  }
  if (destino) {
    e.preventDefault();
    destino.focus();
    destino.select();
  }
}

/** Entre los campos que estén en la fila de abajo (o de arriba), regresa el más cercano en X al
 *  campo actual — así "abajo"/"arriba" se mueve en la misma columna visual, no al azar. */
function vecinoEnFila(inputs: HTMLInputElement[], actual: HTMLInputElement, direccion: 1 | -1): HTMLInputElement | undefined {
  const rectActual = actual.getBoundingClientRect();
  let filaTop: number | null = null;
  for (const inp of inputs) {
    if (inp === actual) continue;
    const r = inp.getBoundingClientRect();
    const enDireccion = direccion === 1 ? r.top > rectActual.top + 4 : r.top < rectActual.top - 4;
    if (!enDireccion) continue;
    if (filaTop === null || (direccion === 1 ? r.top < filaTop : r.top > filaTop)) filaTop = r.top;
  }
  if (filaTop === null) return undefined;

  let mejor: HTMLInputElement | undefined;
  let mejorDistancia = Infinity;
  for (const inp of inputs) {
    const r = inp.getBoundingClientRect();
    if (Math.abs(r.top - filaTop) > 4) continue;
    const distancia = Math.abs(r.left - rectActual.left);
    if (distancia < mejorDistancia) {
      mejorDistancia = distancia;
      mejor = inp;
    }
  }
  return mejor;
}

const tarjeta: CSSProperties = { background: "#fff", padding: 20, borderRadius: 16, display: "flex", flexDirection: "column", gap: 4 };

export function Caja({ sucursalId }: { sucursalId: string }) {
  const { usuario } = useAuthStore();
  const [cajas, setCajas] = useState<CajaDto[]>([]);
  const [cajaId, setCajaId] = useState<string>("");
  const [turno, setTurno] = useState<TurnoDto | null>(null);
  const [montoInicial, setMontoInicial] = useState("500");
  const [resumen, setResumen] = useState<ResumenDto | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [resultadoCorte, setResultadoCorte] = useState<any>(null);
  const [observaciones, setObservaciones] = useState("");

  const [billetesMXN, setBilletesMXN] = useState<Conteo>({});
  const [monedasMXN, setMonedasMXN] = useState<Conteo>({});
  const [billetesUSD, setBilletesUSD] = useState<Conteo>({});
  const [capturado, setCapturado] = useState(false);

  // Cualquier cambio en el desglose invalida una captura previa (hay que volver a confirmar).
  function actualizarBilletesMXN(c: Conteo) { setBilletesMXN(c); setCapturado(false); }
  function actualizarMonedasMXN(c: Conteo) { setMonedasMXN(c); setCapturado(false); }
  function actualizarBilletesUSD(c: Conteo) { setBilletesUSD(c); setCapturado(false); }

  const [tipoMov, setTipoMov] = useState<"INGRESO" | "EGRESO">("EGRESO");
  const [montoMov, setMontoMov] = useState("");
  const [motivoMov, setMotivoMov] = useState("");
  const [enviandoMov, setEnviandoMov] = useState(false);
  const [cerrando, setCerrando] = useState(false);

  useEffect(() => {
    apiFetch<CajaDto[]>(`/sucursales/${sucursalId}/cajas`).then((data) => {
      setCajas(data);
      if (data[0]) setCajaId(data[0].id);
    });
  }, [sucursalId]);

  useEffect(() => {
    if (!cajaId) return;
    apiFetch<TurnoDto | null>(`/caja/cajas/${cajaId}/turno-activo`).then(setTurno);
  }, [cajaId]);

  useEffect(() => {
    if (turno) cargarResumen(turno.id);
  }, [turno]);

  function cargarResumen(turnoId: string) {
    apiFetch<ResumenDto>(`/caja/turnos/${turnoId}/resumen`).then(setResumen).catch(() => undefined);
  }

  function limpiarConteo() {
    setBilletesMXN({});
    setMonedasMXN({});
    setBilletesUSD({});
    setObservaciones("");
    setCapturado(false);
  }

  async function abrir() {
    setMensaje(null);
    try {
      const t = await apiFetch<TurnoDto>("/caja/turnos/abrir", {
        method: "POST",
        body: JSON.stringify({ sucursalId, cajaId, usuarioId: usuario!.id, montoInicial: Number(montoInicial) }),
      });
      setTurno(t);
      setResultadoCorte(null);
    } catch (e: any) {
      setMensaje(e.message);
    }
  }

  async function registrarMovimiento() {
    if (!turno) return;
    const monto = Number(montoMov);
    if (!monto || monto <= 0 || !motivoMov.trim()) {
      setMensaje("Indica un monto y un motivo válidos para el movimiento");
      return;
    }
    setEnviandoMov(true);
    setMensaje(null);
    try {
      await apiFetch(`/caja/turnos/${turno.id}/movimientos`, {
        method: "POST",
        body: JSON.stringify({ tipo: tipoMov, monto, motivo: motivoMov, usuarioId: usuario!.id }),
      });
      setMontoMov("");
      setMotivoMov("");
      cargarResumen(turno.id);
    } catch (e: any) {
      setMensaje(e.message);
    } finally {
      setEnviandoMov(false);
    }
  }

  async function realizarCorte() {
    setMensaje(null);
    if (!turno) return;
    setCerrando(true);
    const totalMXN = totalConteo(billetesMXN) + totalConteo(monedasMXN);
    const totalUSD = totalConteo(billetesUSD);
    try {
      const cerrado = await apiFetch(`/caja/turnos/${turno.id}/cerrar`, {
        method: "POST",
        body: JSON.stringify({
          montoFinalDeclarado: totalMXN,
          desgloseEfectivo: { billetesMXN, monedasMXN, billetesUSD, totalMXN, totalUSD, observaciones },
        }),
      });
      setResultadoCorte(cerrado);
      setTurno(null);
      limpiarConteo();
    } catch (e: any) {
      setMensaje(e.message);
    } finally {
      setCerrando(false);
    }
  }

  const totalMXNContado = totalConteo(billetesMXN) + totalConteo(monedasMXN);
  const totalUSDContado = totalConteo(billetesUSD);
  const diferenciaEnVivo = resumen ? round2(totalMXNContado - resumen.montoEsperado) : null;
  const estadoDiferencia = diferenciaEnVivo === null ? null : diferenciaEnVivo === 0 ? "correcto" : diferenciaEnVivo > 0 ? "sobrante" : "faltante";
  const ESTADO_INFO: Record<string, { texto: string; color: string }> = {
    correcto: { texto: "✓ Correcto", color: "var(--h421-esmeralda)" },
    sobrante: { texto: "▲ Sobrante", color: "var(--h421-blue)" },
    faltante: { texto: "▼ Faltante", color: "var(--h421-red)" },
  };

  return (
    <div style={{ padding: "20px 28px", height: "100%", overflowY: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <h2 style={{ margin: 0 }}>Caja</h2>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
          Caja
          <select value={cajaId} onChange={(e) => setCajaId(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--h421-gray-200)" }}>
            {cajas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
      </div>

      {!turno && !resultadoCorte && (
        <div style={{ ...tarjeta, maxWidth: 420 }}>
          <h3 style={{ margin: 0 }}>Apertura de turno</h3>
          <label style={{ marginTop: 10 }}>
            Monto inicial
            <input type="number" value={montoInicial} onChange={(e) => setMontoInicial(e.target.value)} style={{ display: "block", width: "100%", padding: 12, marginTop: 4, borderRadius: 8, border: "1px solid var(--h421-gray-200)", fontSize: 16 }} />
          </label>
          <button onClick={abrir} className="btn-grande btn-pagar" style={{ width: "100%", marginTop: 14 }}>
            Abrir caja
          </button>
        </div>
      )}

      {turno && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20, alignItems: "start" }}>
          {/* Columna izquierda: resumen del turno */}
          <div style={tarjeta}>
            <h3 style={{ margin: 0 }}>Resumen del turno</h3>
            <p style={{ color: "var(--h421-gray-400)", margin: "0 0 8px", fontSize: 13 }}>
              Abierto desde {new Date(turno.fechaApertura).toLocaleString("es-MX")}
            </p>

            {resumen && (
              <table style={{ width: "100%", fontSize: 14, borderCollapse: "collapse" }}>
                <tbody>
                  <tr><td style={{ padding: "4px 0" }}>Fondo inicial</td><td style={{ textAlign: "right" }}>${Number(resumen.turno.montoInicial).toFixed(2)}</td></tr>
                  {resumen.pagosPorMetodo.map((p) => (
                    <tr key={p.metodo}>
                      <td style={{ padding: "4px 0" }}>Ventas {ETIQUETA_METODO[p.metodo] ?? p.metodo} ({p._count})</td>
                      <td style={{ textAlign: "right" }}>${Number(p._sum.monto ?? 0).toFixed(2)}</td>
                    </tr>
                  ))}
                  <tr><td style={{ padding: "4px 0" }}>Ingresos de caja</td><td style={{ textAlign: "right", color: "var(--h421-esmeralda)" }}>+${resumen.totalIngresos.toFixed(2)}</td></tr>
                  <tr><td style={{ padding: "4px 0" }}>Egresos de caja</td><td style={{ textAlign: "right", color: "var(--h421-red)" }}>−${resumen.totalEgresos.toFixed(2)}</td></tr>
                  <tr style={{ fontWeight: 800, borderTop: "1px solid var(--h421-gray-200)" }}>
                    <td style={{ paddingTop: 8 }}>Efectivo esperado</td>
                    <td style={{ textAlign: "right", paddingTop: 8, color: "var(--h421-navy)" }}>${resumen.montoEsperado.toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>

          {/* Columna central: movimientos + desglose de efectivo */}
          <div style={tarjeta}>
            <h3 style={{ margin: 0 }}>Registrar ingreso / egreso</h3>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 4 }}>
              <button onClick={() => setTipoMov("INGRESO")} style={{ padding: "10px 16px", background: tipoMov === "INGRESO" ? "var(--h421-esmeralda)" : "var(--h421-gray-50)", color: tipoMov === "INGRESO" ? "#fff" : "#000" }}>Ingreso</button>
              <button onClick={() => setTipoMov("EGRESO")} style={{ padding: "10px 16px", background: tipoMov === "EGRESO" ? "var(--h421-red)" : "var(--h421-gray-50)", color: tipoMov === "EGRESO" ? "#fff" : "#000" }}>Egreso</button>
            </div>
            <input type="number" placeholder="Monto" value={montoMov} onChange={(e) => setMontoMov(e.target.value)}
              style={{ width: "100%", padding: 12, borderRadius: 8, border: "1px solid var(--h421-gray-200)", marginTop: 8 }} />
            <input placeholder="Motivo (ej. compra de hielo)" value={motivoMov} onChange={(e) => setMotivoMov(e.target.value)}
              style={{ width: "100%", padding: 12, borderRadius: 8, border: "1px solid var(--h421-gray-200)", marginTop: 8 }} />
            <button onClick={registrarMovimiento} disabled={enviandoMov} className="btn-grande" style={{ marginTop: 8, background: "var(--h421-navy)", color: "#fff" }}>
              Registrar
            </button>

            {resumen && resumen.movimientos.length > 0 && (
              <ul style={{ listStyle: "none", padding: 0, marginTop: 8, marginBottom: 4, fontSize: 13, maxHeight: 140, overflowY: "auto" }}>
                {resumen.movimientos.map((m) => (
                  <li key={m.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid var(--h421-gray-200)" }}>
                    <span>{m.tipo === "INGRESO" ? "▲" : "▼"} {m.motivo}</span>
                    <span style={{ color: m.tipo === "INGRESO" ? "var(--h421-esmeralda)" : "var(--h421-red)", fontWeight: 700 }}>
                      {m.tipo === "INGRESO" ? "+" : "−"}${Number(m.monto).toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <h3 style={{ margin: "12px 0 0" }}>Desglose de efectivo</h3>
            <p style={{ margin: "0 0 4px", fontSize: 12, color: "var(--h421-gray-400)" }}>
              Enter o las flechas (↑ ↓ ← →) mueven entre los campos — sin usar el mouse.
            </p>
            <div data-desglose-container>
              <GrupoDenominaciones titulo="Billetes MXN" denominaciones={BILLETES_MXN} conteo={billetesMXN} onChange={actualizarBilletesMXN} prefijo="$" />
              <GrupoDenominaciones titulo="Monedas MXN" denominaciones={MONEDAS_MXN} conteo={monedasMXN} onChange={actualizarMonedasMXN} prefijo="$" />
              <GrupoDenominaciones titulo="Billetes USD" denominaciones={BILLETES_USD} conteo={billetesUSD} onChange={actualizarBilletesUSD} prefijo="US$" />
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, padding: "10px 14px", background: "var(--h421-gray-50)", borderRadius: 10 }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>
                Total del desglose{totalUSDContado > 0 ? " (MXN + USD informativo)" : ""}
              </span>
              <span style={{ fontSize: 18, fontWeight: 800, color: "var(--h421-navy)" }}>
                ${totalMXNContado.toFixed(2)}{totalUSDContado > 0 ? ` + US$${totalUSDContado.toFixed(2)}` : ""}
              </span>
            </div>
            <button onClick={() => setCapturado(true)} className="btn-grande" style={{ marginTop: 8, background: capturado ? "var(--h421-esmeralda)" : "var(--h421-navy)", color: "#fff" }}>
              {capturado ? "✓ Capturado" : "Capturar"}
            </button>
          </div>

          {/* Columna derecha: bloque de corte, siempre visible */}
          <div style={{ ...tarjeta, position: "sticky", top: 0, border: "2px solid var(--h421-navy)" }}>
            <h3 style={{ margin: 0 }}>Corte de caja</h3>

            <div style={{ fontSize: 14, marginTop: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                <span>Efectivo esperado</span>
                <strong>${(resumen?.montoEsperado ?? 0).toFixed(2)}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                <span>Efectivo contado</span>
                <strong>${totalMXNContado.toFixed(2)}</strong>
              </div>
              {totalUSDContado > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", color: "var(--h421-gray-400)" }}>
                  <span>Contado en USD (informativo)</span>
                  <span>US${totalUSDContado.toFixed(2)}</span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderTop: "1px solid var(--h421-gray-200)", fontWeight: 800, fontSize: 17 }}>
                <span>Diferencia</span>
                <span style={{ color: estadoDiferencia ? ESTADO_INFO[estadoDiferencia].color : "var(--h421-black)" }}>
                  ${(diferenciaEnVivo ?? 0).toFixed(2)}
                </span>
              </div>
            </div>

            {estadoDiferencia && (
              <div style={{
                textAlign: "center", padding: "8px 12px", borderRadius: 10, fontWeight: 800, fontSize: 15,
                background: `${ESTADO_INFO[estadoDiferencia].color}1f`, color: ESTADO_INFO[estadoDiferencia].color,
              }}>
                {ESTADO_INFO[estadoDiferencia].texto}
              </div>
            )}

            <label style={{ marginTop: 8 }}>
              Observaciones
              <textarea
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                placeholder="Ej. faltante por cambio no registrado…"
                rows={3}
                style={{ display: "block", width: "100%", padding: 10, marginTop: 4, borderRadius: 8, border: "1px solid var(--h421-gray-200)", resize: "vertical" }}
              />
            </label>

            <button onClick={realizarCorte} disabled={cerrando} className="btn-grande btn-pagar" style={{ marginTop: 8 }}>
              {cerrando ? "Procesando…" : "Realizar corte de caja"}
            </button>
            <button onClick={limpiarConteo} style={{ background: "var(--h421-gray-200)", color: "var(--h421-black)" }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {mensaje && <p style={{ color: "var(--h421-red)" }}>{mensaje}</p>}

      {resultadoCorte && (
        <div style={{ ...tarjeta, maxWidth: 420, marginTop: 16 }}>
          <strong>Resumen del corte</strong>
          <p style={{ margin: "6px 0" }}>Sistema (efectivo esperado): ${Number(resultadoCorte.montoFinalSistema).toFixed(2)}</p>
          <p style={{ margin: "6px 0" }}>Declarado (contado): ${Number(resultadoCorte.montoFinalDeclarado).toFixed(2)}</p>
          <p style={{ margin: "6px 0", color: Number(resultadoCorte.diferencia) === 0 ? "var(--h421-esmeralda)" : "var(--h421-red)", fontWeight: 700 }}>
            Diferencia: ${Number(resultadoCorte.diferencia).toFixed(2)}
          </p>
        </div>
      )}
    </div>
  );
}

function GrupoDenominaciones({
  titulo, denominaciones, conteo, onChange, prefijo,
}: {
  titulo: string;
  denominaciones: number[];
  conteo: Conteo;
  onChange: (c: Conteo) => void;
  prefijo: string;
}) {
  return (
    <div style={{ marginTop: 10 }}>
      <h4 style={{ margin: "0 0 6px", fontSize: 13, color: "var(--h421-gray-400)", textTransform: "uppercase", letterSpacing: 0.4 }}>{titulo}</h4>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 8 }}>
        {denominaciones.map((d) => (
          <div key={d} style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--h421-gray-50)", borderRadius: 8, padding: "6px 10px" }}>
            <span style={{ fontSize: 13, fontWeight: 700, minWidth: 42 }}>{prefijo}{d}</span>
            <input
              type="number"
              min={0}
              data-denom-input
              value={conteo[d] ?? ""}
              onChange={(e) => onChange({ ...conteo, [d]: Number(e.target.value) })}
              onKeyDown={manejarTeclaDesglose}
              placeholder="0"
              style={{ width: 48, padding: 6, borderRadius: 6, border: "1px solid var(--h421-gray-200)" }}
            />
            <span style={{ fontSize: 11, color: "var(--h421-gray-400)", marginLeft: "auto" }}>
              = {prefijo}{((conteo[d] || 0) * d).toFixed(2)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
