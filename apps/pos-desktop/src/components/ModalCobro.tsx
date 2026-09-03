import { useState } from "react";
import { MetodoPago } from "@hangar421/shared";
import { useOrderStore } from "../store/orderStore";

const METODOS: { valor: MetodoPago; etiqueta: string; icono: string }[] = [
  { valor: MetodoPago.EFECTIVO, etiqueta: "Efectivo", icono: "💵" },
  { valor: MetodoPago.TARJETA, etiqueta: "Tarjeta", icono: "💳" },
  { valor: MetodoPago.TRANSFERENCIA, etiqueta: "Transferencia", icono: "🏦" },
  { valor: MetodoPago.QR, etiqueta: "QR", icono: "▦" },
];

const PROPINAS_RAPIDAS = [10, 15, 20];
const TECLAS = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "0", ".", "borrar"];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function ModalCobro({ mesaNombre, onCerrar, onCobrado }: { mesaNombre: string | null; onCerrar: () => void; onCobrado: () => void }) {
  const { items, totales, descuentos, cobrar } = useOrderStore();
  const t = totales();

  const [metodoActivo, setMetodoActivo] = useState<MetodoPago>(MetodoPago.EFECTIVO);

  // Propina: por porcentaje rápido (10/15/20), personalizado (% o $ directo) — el importe manual
  // manda sobre el porcentaje si ambos están cargados.
  const [propinaPorcentaje, setPropinaPorcentaje] = useState(0);
  const [propinaPorcentajeTexto, setPropinaPorcentajeTexto] = useState("");
  const [propinaMontoTexto, setPropinaMontoTexto] = useState("");
  const propina = propinaMontoTexto !== "" ? Number(propinaMontoTexto) || 0 : round2(t.total * (propinaPorcentaje / 100));
  const totalAPagar = round2(t.total + propina);

  const [pagos, setPagos] = useState<{ metodo: MetodoPago; monto: number }[]>([]);
  const [montoInput, setMontoInput] = useState(totalAPagar.toFixed(2));
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pagadoHasta = pagos.reduce((s, p) => s + p.monto, 0);
  const restante = Math.max(0, totalAPagar - pagadoHasta);
  const cambio = Math.max(0, pagadoHasta + Number(montoInput || 0) - totalAPagar);

  function presionarTecla(tecla: string) {
    setMontoInput((m) => {
      if (tecla === "borrar") return m.length > 1 ? m.slice(0, -1) : "0";
      if (tecla === ".") return m.includes(".") ? m : `${m}.`;
      return m === "0" ? tecla : m + tecla;
    });
  }

  function agregarPago() {
    const monto = Number(montoInput);
    if (!monto || monto <= 0) return;
    setPagos((p) => [...p, { metodo: metodoActivo, monto }]);
    setMontoInput(Math.max(0, restante - monto).toFixed(2));
  }

  function elegirPropinaRapida(pct: number) {
    setPropinaPorcentaje(pct);
    setPropinaPorcentajeTexto("");
    setPropinaMontoTexto("");
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
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 20, width: "100%", maxWidth: 980, maxHeight: "92vh", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(11,30,51,0.3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 24px", borderBottom: "1px solid var(--h421-gray-200)" }}>
          <h2 style={{ margin: 0, fontSize: 19 }}>Cobrar · {mesaNombre ? mesaNombre : "Mostrador"}</h2>
          <button onClick={onCerrar} style={{ background: "none", color: "var(--h421-gray-400)", fontSize: 22, minHeight: 0, padding: 4 }}>✕</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1.25fr 1fr", flex: 1, overflow: "hidden" }}>
          {/* Columna izquierda: detalle, método, propina, descuento, confirmación */}
          <div style={{ padding: 24, overflowY: "auto", borderRight: "1px solid var(--h421-gray-200)" }}>
            {items.map((item) => (
              <div key={item.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "4px 0" }}>
                <span>{item.cantidad}× {item.nombreProducto}</span>
                <span>${((item.precioUnitario + item.modificadores.reduce((s, m) => s + m.precioExtra, 0)) * item.cantidad).toFixed(2)} MXN</span>
              </div>
            ))}

            <div style={{ borderTop: "1px solid var(--h421-gray-200)", marginTop: 10, paddingTop: 10, fontSize: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", color: "var(--h421-gray-400)" }}>
                <span>Subtotal</span><span>${t.subtotal.toFixed(2)} MXN</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", color: "var(--h421-gray-400)" }}>
                <span>Impuesto</span><span>${t.impuesto.toFixed(2)} MXN</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: 20, marginTop: 4 }}>
                <span>Total</span><span>${t.total.toFixed(2)} MXN</span>
              </div>
            </div>

            <h4 style={{ marginBottom: 8, marginTop: 18 }}>Método de pago</h4>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {METODOS.map((m) => (
                <button key={m.valor} onClick={() => setMetodoActivo(m.valor)}
                  style={{ padding: "12px 16px", background: metodoActivo === m.valor ? "var(--h421-navy)" : "var(--h421-gray-50)", color: metodoActivo === m.valor ? "#fff" : "#000" }}>
                  {m.icono} {m.etiqueta}
                </button>
              ))}
            </div>

            <h4 style={{ marginBottom: 8, marginTop: 18 }}>Propina</h4>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={() => elegirPropinaRapida(0)}
                style={{ padding: "12px 16px", background: propina === 0 ? "var(--h421-navy)" : "var(--h421-gray-50)", color: propina === 0 ? "#fff" : "#000" }}>
                Sin propina
              </button>
              {PROPINAS_RAPIDAS.map((pct) => (
                <button key={pct} onClick={() => elegirPropinaRapida(pct)}
                  style={{ padding: "12px 16px", background: propinaMontoTexto === "" && propinaPorcentaje === pct ? "var(--h421-navy)" : "var(--h421-gray-50)", color: propinaMontoTexto === "" && propinaPorcentaje === pct ? "#fff" : "#000" }}>
                  {pct}%
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <input type="number" placeholder="Porcentaje %" value={propinaPorcentajeTexto}
                onChange={(e) => { setPropinaPorcentajeTexto(e.target.value); setPropinaPorcentaje(Number(e.target.value) || 0); setPropinaMontoTexto(""); }}
                style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
              <input type="number" placeholder="Importe $" value={propinaMontoTexto}
                onChange={(e) => setPropinaMontoTexto(e.target.value)}
                style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
            </div>

            <h4 style={{ marginBottom: 4, marginTop: 18 }}>Descuento / Cortesía</h4>
            <p style={{ margin: 0, fontSize: 13, color: "var(--h421-gray-400)" }}>
              {t.descuentoTotal > 0
                ? <>Aplicado: <strong style={{ color: "var(--h421-black)" }}>−${t.descuentoTotal.toFixed(2)}</strong> {descuentos[0]?.motivo ? `(${descuentos[0].motivo})` : ""}</>
                : <>Sin descuento — se autoriza desde el botón <strong>% Descuento</strong> del panel de venta (requiere PIN de supervisor).</>}
            </p>

            {pagos.length > 0 && (
              <ul style={{ listStyle: "none", padding: 0, marginTop: 14, fontSize: 14 }}>
                {pagos.map((p, i) => (
                  <li key={i} style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>{METODOS.find((m) => m.valor === p.metodo)?.etiqueta}</span>
                    <span>${p.monto.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            )}

            <div style={{ borderTop: "1px solid var(--h421-gray-200)", marginTop: 14, paddingTop: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: "var(--h421-gray-400)" }}>
                <span>Propina</span><span>${propina.toFixed(2)} MXN</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: 20 }}>
                <span>Total a pagar</span><span>${totalAPagar.toFixed(2)} MXN</span>
              </div>
              <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--h421-gray-400)" }}>
                {restante > 0 ? <>Falta cubrir: ${restante.toFixed(2)}</> : <span style={{ color: "var(--h421-esmeralda)", fontWeight: 700 }}>Cambio: ${cambio.toFixed(2)}</span>}
              </p>
            </div>

            {error && <p style={{ color: "var(--h421-red)" }}>{error}</p>}

            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button onClick={onCerrar} style={{ flex: 1, padding: 14, background: "var(--h421-gray-200)" }}>Cancelar</button>
              <button onClick={confirmar} disabled={procesando} className="btn-grande btn-pagar" style={{ flex: 2, fontSize: 16 }}>
                {procesando ? "Procesando…" : "Confirmar pago"}
              </button>
            </div>
          </div>

          {/* Columna derecha: teclado numérico para el monto de este pago */}
          <div style={{ padding: 24, background: "var(--h421-gray-50)", display: "flex", flexDirection: "column" }}>
            <p style={{ margin: "0 0 8px", fontSize: 13, color: "var(--h421-gray-400)", textAlign: "center" }}>Monto ingresado</p>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#fff", borderRadius: 12, padding: "16px 20px", fontSize: 30, fontWeight: 800, border: "1px solid var(--h421-gray-200)" }}>
              <span>$</span>
              <span>{montoInput}</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginTop: 16, flex: 1 }}>
              {TECLAS.map((k) => (
                <button
                  key={k}
                  onClick={() => presionarTecla(k)}
                  style={{
                    fontSize: 22, fontWeight: 700, background: k === "borrar" ? "#fee2e2" : "#fff",
                    color: k === "borrar" ? "var(--h421-red)" : "var(--h421-navy)",
                    border: "1px solid var(--h421-gray-200)", minHeight: 56,
                  }}
                >
                  {k === "borrar" ? "Borrar" : k}
                </button>
              ))}
            </div>

            <button onClick={agregarPago} className="btn-grande" style={{ marginTop: 10, background: "var(--h421-navy)", color: "#fff", fontSize: 16 }}>
              ENTER · Agregar pago
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
