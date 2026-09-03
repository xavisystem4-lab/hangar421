import { useState } from "react";
import { MetodoPago } from "@hangar421/shared";
import { useOrderStore } from "../store/orderStore";

const METODOS: { valor: MetodoPago; etiqueta: string; icono: string }[] = [
  { valor: MetodoPago.EFECTIVO, etiqueta: "Efectivo", icono: "💵" },
  { valor: MetodoPago.TARJETA, etiqueta: "Tarjeta", icono: "💳" },
  { valor: MetodoPago.TRANSFERENCIA, etiqueta: "Transferencia", icono: "🏦" },
  { valor: MetodoPago.QR, etiqueta: "QR", icono: "▦" },
];

export function ModalCobro({ onCerrar, onCobrado }: { onCerrar: () => void; onCobrado: () => void }) {
  const { totales, cobrar } = useOrderStore();
  const total = totales().total;
  const [pagos, setPagos] = useState<{ metodo: MetodoPago; monto: number }[]>([]);
  const [metodoActivo, setMetodoActivo] = useState<MetodoPago>(MetodoPago.EFECTIVO);
  const [montoInput, setMontoInput] = useState(total.toFixed(2));
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pagadoHasta = pagos.reduce((s, p) => s + p.monto, 0);
  const restante = Math.max(0, total - pagadoHasta);
  const cambio = Math.max(0, pagadoHasta + Number(montoInput || 0) - total);

  function agregarPago() {
    const monto = Number(montoInput);
    if (!monto || monto <= 0) return;
    setPagos((p) => [...p, { metodo: metodoActivo, monto }]);
    setMontoInput(Math.max(0, restante - monto).toFixed(2));
  }

  async function confirmar() {
    setError(null);
    const pagosFinales = pagos.length > 0 ? pagos : [{ metodo: metodoActivo, monto: Number(montoInput) }];
    setProcesando(true);
    try {
      await cobrar(pagosFinales);
      onCobrado();
    } catch (e: any) {
      setError(e.message ?? "No se pudo procesar el cobro");
    } finally {
      setProcesando(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 24, width: 420 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Cobrar</h2>
          <button onClick={onCerrar} style={{ background: "none", fontSize: 20 }}>✕</button>
        </div>
        <p style={{ fontSize: 28, fontWeight: 800, color: "var(--h421-navy)" }}>${total.toFixed(2)}</p>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {METODOS.map((m) => (
            <button key={m.valor} onClick={() => setMetodoActivo(m.valor)}
              style={{ padding: "10px 14px", background: metodoActivo === m.valor ? "var(--h421-navy)" : "var(--h421-gray-50)", color: metodoActivo === m.valor ? "#fff" : "#000" }}>
              {m.icono} {m.etiqueta}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 14, alignItems: "center" }}>
          <input type="number" value={montoInput} onChange={(e) => setMontoInput(e.target.value)}
            style={{ flex: 1, padding: 12, borderRadius: 8, border: "1px solid var(--h421-gray-200)", fontSize: 16 }} />
          <button onClick={agregarPago} style={{ padding: "12px 16px", background: "var(--h421-blue)", color: "#fff" }}>➗ Agregar pago</button>
        </div>

        {pagos.length > 0 && (
          <ul style={{ listStyle: "none", padding: 0, marginTop: 10, fontSize: 14 }}>
            {pagos.map((p, i) => (
              <li key={i} style={{ display: "flex", justifyContent: "space-between" }}>
                <span>{METODOS.find((m) => m.valor === p.metodo)?.etiqueta}</span>
                <span>${p.monto.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        )}

        <div style={{ marginTop: 12, fontSize: 14, color: "var(--h421-gray-400)" }}>
          {restante > 0 ? <span>Falta cubrir: ${restante.toFixed(2)}</span> : <span style={{ color: "var(--h421-green)", fontWeight: 700 }}>Cambio: ${cambio.toFixed(2)}</span>}
        </div>

        {error && <p style={{ color: "var(--h421-red)" }}>{error}</p>}

        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button onClick={onCerrar} style={{ flex: 1, padding: 14, background: "var(--h421-gray-200)" }}>Cancelar</button>
          <button onClick={confirmar} disabled={procesando} className="btn-grande"
            style={{ flex: 2, background: "var(--h421-esmeralda)", color: "#fff", fontSize: 16 }}>
            {procesando ? "Procesando…" : "CONFIRMAR COBRO"}
          </button>
        </div>
      </div>
    </div>
  );
}
