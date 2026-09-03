import { useEffect, useState } from "react";
import { MetodoPago } from "@hangar421/shared";
import { useOrderStore } from "../store/orderStore";
import { useAuthStore } from "../store/authStore";
import { ModalDescuento } from "./ModalDescuento";

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
  const { items, totales, descuentos, pedidoId, enviarACocina, cobrar } = useOrderStore();
  const sucursalId = useAuthStore((s) => s.sucursalId)!;
  const t = totales();
  const [mostrarDescuento, setMostrarDescuento] = useState(false);

  const [metodoActivo, setMetodoActivo] = useState<MetodoPago>(MetodoPago.EFECTIVO);

  // Propina: por porcentaje rápido (10/15/20), personalizado (% o $ directo) — el importe manual
  // manda sobre el porcentaje si ambos están cargados.
  const [propinaPorcentaje, setPropinaPorcentaje] = useState(0);
  const [propinaPorcentajeTexto, setPropinaPorcentajeTexto] = useState("");
  const [propinaMontoTexto, setPropinaMontoTexto] = useState("");
  const propina = propinaMontoTexto !== "" ? Number(propinaMontoTexto) || 0 : round2(t.total * (propinaPorcentaje / 100));
  const totalAPagar = round2(t.total + propina);

  const [pagos, setPagos] = useState<{ metodo: MetodoPago; monto: number }[]>([]);
  // Arranca en $0.00 — el cajero debe escribir el monto a mano, no se asume que paga el total
  // exacto (así se ve/confirma lo que realmente se está tecleando antes de cobrar).
  const [montoInput, setMontoInput] = useState("0");
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pagadoHasta = pagos.reduce((s, p) => s + p.monto, 0);
  // Incluye lo que se está tecleando en el momento (no solo los pagos ya agregados) — así el
  // cambio/falta-cubrir se actualiza en cuanto se escribe el importe, sin esperar a "Agregar pago".
  const totalConTeclaActual = pagadoHasta + Number(montoInput || 0);
  const restante = Math.max(0, totalAPagar - totalConTeclaActual);
  const cambio = Math.max(0, totalConTeclaActual - totalAPagar);

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
    // `restante` ya descuenta lo que se acaba de escribir (ver más arriba), así que es
    // directamente lo que falta para el próximo pago (0 si este ya cubrió todo).
    setMontoInput(restante.toFixed(2));
  }

  // Teclado físico de la PC (fila numérica o numpad) — funciona en cuanto se abre la ventana,
  // sin tener que hacerle clic al teclado en pantalla primero. Se ignora mientras el foco esté
  // en un <input>/<textarea> real (ej. "Porcentaje %", "Motivo" del descuento) para no duplicar
  // lo que se esté escribiendo ahí. Enter confirma el cobro completo (no solo agrega un pago
  // parcial — para eso sigue estando el botón "Agregar pago" con el mouse) y Esc cancela/cierra
  // la ventana, igual que el botón "Cancelar".
  useEffect(() => {
    function manejarTecladoFisico(e: KeyboardEvent) {
      const foco = document.activeElement;
      if (foco && (foco.tagName === "INPUT" || foco.tagName === "TEXTAREA")) return;

      if (/^[0-9]$/.test(e.key)) {
        presionarTecla(e.key);
        e.preventDefault();
      } else if (e.key === "." || e.key === ",") {
        presionarTecla(".");
        e.preventDefault();
      } else if (e.key === "Backspace" || e.key === "Delete") {
        presionarTecla("borrar");
        e.preventDefault();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (!procesando) confirmar();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCerrar();
      }
    }
    window.addEventListener("keydown", manejarTecladoFisico);
    return () => window.removeEventListener("keydown", manejarTecladoFisico);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [montoInput, restante, metodoActivo, pagos, procesando, propina, totalAPagar]);

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
      // Este negocio no tiene cocina — no hay un paso separado de "enviar pedido"; el pedido
      // se crea aquí mismo (si todavía no existe) y se cobra en el mismo toque de "Confirmar
      // pago". Al estar ya dentro del modal, cualquier error de esta creación se ve en pantalla
      // en vez de bloquear silenciosamente la apertura de la ventana de cobro.
      if (!pedidoId) await enviarACocina();
      await cobrar(pagosFinales);
      onCobrado();
    } catch (e: any) {
      setError(e.message ?? "No se pudo procesar el cobro");
    } finally {
      setProcesando(false);
    }
  }

  return (
    <>
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

            <div style={{ borderTop: "1px solid var(--h421-gray-200)", marginTop: 10, paddingTop: 10, fontSize: 16, fontWeight: 700, color: "var(--h421-navy)" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Subtotal</span><span>${t.subtotal.toFixed(2)} MXN</span>
              </div>
              {t.descuentoTotal > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Descuento</span><span>−${t.descuentoTotal.toFixed(2)} MXN</span>
                </div>
              )}
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
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--h421-navy)" }}>
                {t.descuentoTotal > 0
                  ? <>Aplicado: <strong>−${t.descuentoTotal.toFixed(2)}</strong> {descuentos[0]?.motivo ? `(${descuentos[0].motivo})` : ""}</>
                  : "Sin descuento aplicado."}
              </p>
              <button onClick={() => setMostrarDescuento(true)} style={{ padding: "8px 14px", fontSize: 13, background: "var(--h421-yellow)", color: "#000", flexShrink: 0 }}>
                {t.descuentoTotal > 0 ? "Cambiar" : "% Descuento"}
              </button>
            </div>
            <p style={{ margin: "4px 0 0", fontSize: 14, fontWeight: 700, color: "var(--h421-navy)" }}>Requiere PIN de supervisor.</p>

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
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 16, fontWeight: 700, color: "var(--h421-navy)" }}>
                <span>Propina</span><span>${propina.toFixed(2)} MXN</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: 20 }}>
                <span>Total a pagar</span><span>${totalAPagar.toFixed(2)} MXN</span>
              </div>
              <p style={{ margin: "6px 0 0", fontSize: 19, fontWeight: 800 }}>
                {restante > 0
                  ? <span style={{ color: "var(--h421-navy)" }}>Falta cubrir: ${restante.toFixed(2)}</span>
                  : <span style={{ color: "var(--h421-esmeralda)" }}>Cambio: ${cambio.toFixed(2)}</span>}
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
              Agregar pago
            </button>
            <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--h421-gray-400)", textAlign: "center" }}>
              Enter confirma el cobro · Esc cancela
            </p>
          </div>
        </div>
      </div>
    </div>

    {mostrarDescuento && (
      <ModalDescuento sucursalId={sucursalId} onCerrar={() => setMostrarDescuento(false)} />
    )}
    </>
  );
}
