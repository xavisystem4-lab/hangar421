import { useEffect, useState } from "react";
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

export function Caja({ sucursalId }: { sucursalId: string }) {
  const { usuario } = useAuthStore();
  const [cajas, setCajas] = useState<CajaDto[]>([]);
  const [cajaId, setCajaId] = useState<string>("");
  const [turno, setTurno] = useState<TurnoDto | null>(null);
  const [montoInicial, setMontoInicial] = useState("500");
  const [resumen, setResumen] = useState<ResumenDto | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [resultadoCorte, setResultadoCorte] = useState<any>(null);

  const [billetesMXN, setBilletesMXN] = useState<Conteo>({});
  const [monedasMXN, setMonedasMXN] = useState<Conteo>({});
  const [billetesUSD, setBilletesUSD] = useState<Conteo>({});

  const [tipoMov, setTipoMov] = useState<"INGRESO" | "EGRESO">("EGRESO");
  const [montoMov, setMontoMov] = useState("");
  const [motivoMov, setMotivoMov] = useState("");
  const [enviandoMov, setEnviandoMov] = useState(false);

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

  async function cerrar() {
    setMensaje(null);
    if (!turno) return;
    const totalMXN = totalConteo(billetesMXN) + totalConteo(monedasMXN);
    const totalUSD = totalConteo(billetesUSD);
    try {
      const cerrado = await apiFetch(`/caja/turnos/${turno.id}/cerrar`, {
        method: "POST",
        body: JSON.stringify({
          montoFinalDeclarado: totalMXN,
          desgloseEfectivo: { billetesMXN, monedasMXN, billetesUSD, totalMXN, totalUSD },
        }),
      });
      setResultadoCorte(cerrado);
      setTurno(null);
      setBilletesMXN({});
      setMonedasMXN({});
      setBilletesUSD({});
    } catch (e: any) {
      setMensaje(e.message);
    }
  }

  const totalMXNContado = totalConteo(billetesMXN) + totalConteo(monedasMXN);
  const totalUSDContado = totalConteo(billetesUSD);

  return (
    <div style={{ padding: 24, maxWidth: 640, height: "100%", overflowY: "auto" }}>
      <h2 style={{ marginTop: 0 }}>Caja</h2>
      <label style={{ display: "block", marginBottom: 16 }}>
        Caja
        <select value={cajaId} onChange={(e) => setCajaId(e.target.value)} style={{ display: "block", width: "100%", padding: 10, marginTop: 4, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }}>
          {cajas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
      </label>

      {!turno && !resultadoCorte && (
        <div style={{ background: "#fff", padding: 20, borderRadius: 12 }}>
          <h3 style={{ marginTop: 0 }}>Apertura de turno</h3>
          <label>
            Monto inicial
            <input type="number" value={montoInicial} onChange={(e) => setMontoInicial(e.target.value)} style={{ display: "block", width: "100%", padding: 10, marginTop: 4, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
          </label>
          <button onClick={abrir} className="btn-grande" style={{ width: "100%", marginTop: 14, background: "var(--h421-esmeralda)", color: "#fff" }}>
            Abrir caja
          </button>
        </div>
      )}

      {turno && (
        <>
          <div style={{ background: "#fff", padding: 20, borderRadius: 12, marginBottom: 16 }}>
            <h3 style={{ marginTop: 0 }}>Resumen del turno</h3>
            <p style={{ color: "var(--h421-gray-400)", marginTop: -6 }}>Abierto desde {new Date(turno.fechaApertura).toLocaleString("es-MX")}</p>

            {resumen && (
              <>
                <table style={{ width: "100%", fontSize: 14, borderCollapse: "collapse" }}>
                  <tbody>
                    <tr><td>Fondo inicial</td><td style={{ textAlign: "right" }}>${Number(resumen.turno.montoInicial).toFixed(2)}</td></tr>
                    {resumen.pagosPorMetodo.map((p) => (
                      <tr key={p.metodo}>
                        <td>Ventas {ETIQUETA_METODO[p.metodo] ?? p.metodo} ({p._count})</td>
                        <td style={{ textAlign: "right" }}>${Number(p._sum.monto ?? 0).toFixed(2)}</td>
                      </tr>
                    ))}
                    <tr><td>Ingresos de caja</td><td style={{ textAlign: "right", color: "var(--h421-green)" }}>+${resumen.totalIngresos.toFixed(2)}</td></tr>
                    <tr><td>Egresos de caja</td><td style={{ textAlign: "right", color: "var(--h421-red)" }}>−${resumen.totalEgresos.toFixed(2)}</td></tr>
                    <tr style={{ fontWeight: 800, borderTop: "1px solid var(--h421-gray-200)" }}>
                      <td style={{ paddingTop: 6 }}>Efectivo esperado en caja</td>
                      <td style={{ textAlign: "right", paddingTop: 6 }}>${resumen.montoEsperado.toFixed(2)}</td>
                    </tr>
                  </tbody>
                </table>
              </>
            )}

            <h4 style={{ marginBottom: 6 }}>Registrar ingreso / egreso</h4>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button onClick={() => setTipoMov("INGRESO")} style={{ padding: "8px 14px", background: tipoMov === "INGRESO" ? "var(--h421-green)" : "var(--h421-gray-50)", color: tipoMov === "INGRESO" ? "#fff" : "#000" }}>Ingreso</button>
              <button onClick={() => setTipoMov("EGRESO")} style={{ padding: "8px 14px", background: tipoMov === "EGRESO" ? "var(--h421-red)" : "var(--h421-gray-50)", color: tipoMov === "EGRESO" ? "#fff" : "#000" }}>Egreso</button>
              <input type="number" placeholder="Monto" value={montoMov} onChange={(e) => setMontoMov(e.target.value)}
                style={{ width: 110, padding: 10, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
              <input placeholder="Motivo (ej. compra de hielo)" value={motivoMov} onChange={(e) => setMotivoMov(e.target.value)}
                style={{ flex: 1, minWidth: 160, padding: 10, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
              <button onClick={registrarMovimiento} disabled={enviandoMov} style={{ padding: "10px 16px", background: "var(--h421-navy)", color: "#fff" }}>
                Registrar
              </button>
            </div>

            {resumen && resumen.movimientos.length > 0 && (
              <ul style={{ listStyle: "none", padding: 0, marginTop: 12, fontSize: 13 }}>
                {resumen.movimientos.map((m) => (
                  <li key={m.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid var(--h421-gray-200)" }}>
                    <span>{m.tipo === "INGRESO" ? "▲" : "▼"} {m.motivo}</span>
                    <span style={{ color: m.tipo === "INGRESO" ? "var(--h421-green)" : "var(--h421-red)", fontWeight: 700 }}>
                      {m.tipo === "INGRESO" ? "+" : "−"}${Number(m.monto).toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div style={{ background: "#fff", padding: 20, borderRadius: 12 }}>
            <h3 style={{ marginTop: 0 }}>Corte de caja — desglose de efectivo</h3>

            <GrupoDenominaciones titulo="Billetes MXN" denominaciones={BILLETES_MXN} conteo={billetesMXN} onChange={setBilletesMXN} prefijo="$" />
            <GrupoDenominaciones titulo="Monedas MXN" denominaciones={MONEDAS_MXN} conteo={monedasMXN} onChange={setMonedasMXN} prefijo="$" />
            <GrupoDenominaciones titulo="Billetes USD" denominaciones={BILLETES_USD} conteo={billetesUSD} onChange={setBilletesUSD} prefijo="US$" />

            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 16, fontWeight: 800, marginTop: 12, color: "var(--h421-navy)" }}>
              <span>Total contado (MXN)</span>
              <span>${totalMXNContado.toFixed(2)}</span>
            </div>
            {totalUSDContado > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: "var(--h421-gray-400)" }}>
                <span>Total contado (USD, informativo)</span>
                <span>US${totalUSDContado.toFixed(2)}</span>
              </div>
            )}

            <button onClick={cerrar} className="btn-grande" style={{ width: "100%", marginTop: 16, background: "var(--h421-red)", color: "#fff" }}>
              Cerrar turno
            </button>
          </div>
        </>
      )}

      {mensaje && <p style={{ color: "var(--h421-red)" }}>{mensaje}</p>}

      {resultadoCorte && (
        <div style={{ background: "#fff", padding: 16, borderRadius: 12, marginTop: 14 }}>
          <strong>Resumen del corte</strong>
          <p>Sistema (efectivo esperado): ${Number(resultadoCorte.montoFinalSistema).toFixed(2)}</p>
          <p>Declarado (contado): ${Number(resultadoCorte.montoFinalDeclarado).toFixed(2)}</p>
          <p style={{ color: Number(resultadoCorte.diferencia) === 0 ? "var(--h421-green)" : "var(--h421-red)", fontWeight: 700 }}>
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
    <div style={{ marginBottom: 14 }}>
      <h4 style={{ marginBottom: 6 }}>{titulo}</h4>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
        {denominaciones.map((d) => (
          <div key={d} style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--h421-gray-50)", borderRadius: 8, padding: "6px 10px" }}>
            <span style={{ fontSize: 13, fontWeight: 700, minWidth: 46 }}>{prefijo}{d}</span>
            <input
              type="number"
              min={0}
              value={conteo[d] ?? ""}
              onChange={(e) => onChange({ ...conteo, [d]: Number(e.target.value) })}
              placeholder="0"
              style={{ width: 50, padding: 6, borderRadius: 6, border: "1px solid var(--h421-gray-200)" }}
            />
            <span style={{ fontSize: 12, color: "var(--h421-gray-400)", marginLeft: "auto" }}>
              = {prefijo}{((conteo[d] || 0) * d).toFixed(2)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
