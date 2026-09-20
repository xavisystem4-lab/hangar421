import { useEffect, useState } from "react";
import { MetodoPago, WS_EVENTS, uuid7, type PaymentRequestDTO } from "@hangar421/shared";
import { useOrderStore } from "../store/orderStore";
import { useAuthStore } from "../store/authStore";
import { apiFetch } from "../api/http";
import { obtenerSocket } from "../api/socket";
import { ModalDescuento } from "./ModalDescuento";

interface TerminalPago {
  id: string;
  nombre: string;
  zona: string | null;
  activo: boolean;
  estadoConexion: string;
}

const ETIQUETA_ESTADO_PAGO: Record<string, string> = {
  PENDIENTE: "Esperando confirmación…",
  ENVIADO_A_TERMINAL: "Enviado a la terminal — esperando al cliente…",
  EN_PROCESO: "Procesando en la terminal…",
  APROBADO: "Pago aprobado ✓",
  RECHAZADO: "Pago rechazado",
  CANCELADO: "Cobro cancelado",
  EXPIRADO: "La solicitud expiró",
  ERROR: "Error al procesar el pago",
};
const ESTADOS_FINALES_CON_ERROR = new Set(["RECHAZADO", "CANCELADO", "EXPIRADO", "ERROR"]);

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
  const { items, totales, descuentos, pedidoId, enviarACocina, cobrar, finalizarPagoExterno } = useOrderStore();
  const sucursalId = useAuthStore((s) => s.sucursalId)!;
  const t = totales();
  const [mostrarDescuento, setMostrarDescuento] = useState(false);

  const [metodoActivo, setMetodoActivo] = useState<MetodoPago>(MetodoPago.EFECTIVO);

  // --- Pago con tarjeta (terminal física, coordinado por el backend — ver apps/backend/src/pagos/) ---
  const [terminales, setTerminales] = useState<TerminalPago[]>([]);
  const [terminalId, setTerminalId] = useState("");
  const [solicitudPago, setSolicitudPago] = useState<PaymentRequestDTO | null>(null);
  const [procesandoTarjeta, setProcesandoTarjeta] = useState(false);
  const [errorTarjeta, setErrorTarjeta] = useState<string | null>(null);

  useEffect(() => {
    if (metodoActivo !== MetodoPago.TARJETA || terminales.length > 0) return;
    apiFetch<TerminalPago[]>(`/pagos/terminales?sucursalId=${sucursalId}`)
      .then((ts) => {
        const activas = ts.filter((x) => x.activo);
        setTerminales(activas);
        if (activas[0]) setTerminalId(activas[0].id);
      })
      .catch(() => setErrorTarjeta("No se pudieron cargar las terminales de pago"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metodoActivo]);

  // Escucha la MISMA solicitud en curso por WebSocket (el backend emite a la sucursal y al
  // mesero asignado, ver realtime.gateway.ts / PagosService.emitir) — así el estado se actualiza
  // solo, sin poll, tanto si quien confirma "Iniciar cobro" es la APK del mesero como si es este
  // mismo POS. Un pago APROBADO nunca lo decide la APK ni este componente: solo refleja lo que
  // el backend ya confirmó con el proveedor.
  useEffect(() => {
    const socket = obtenerSocket();
    if (!socket) return;
    function onActualizado(payload: PaymentRequestDTO) {
      setSolicitudPago((actual) => (actual && payload.id === actual.id ? payload : actual));
    }
    socket.on(WS_EVENTS.PAGO_ACTUALIZADO, onActualizado);
    return () => { socket.off(WS_EVENTS.PAGO_ACTUALIZADO, onActualizado); };
  }, []);

  useEffect(() => {
    if (solicitudPago?.estado !== "APROBADO") return;
    finalizarPagoExterno(mesaNombre).then(onCobrado).catch((e) => setErrorTarjeta(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solicitudPago?.estado]);

  async function crearSolicitudTarjeta() {
    setErrorTarjeta(null);
    setProcesandoTarjeta(true);
    try {
      let idPedido = pedidoId;
      if (!idPedido) idPedido = await enviarACocina(mesaNombre);
      const solicitud = await apiFetch<PaymentRequestDTO>("/pagos/solicitudes", {
        method: "POST",
        body: JSON.stringify({ pedidoId: idPedido, terminalId, importe: montoCobrado, idempotencyKey: uuid7() }),
      });
      setSolicitudPago(solicitud);
    } catch (e: any) {
      setErrorTarjeta(e.message ?? "No se pudo crear la solicitud de pago");
    } finally {
      setProcesandoTarjeta(false);
    }
  }

  async function iniciarCobroEnTerminal() {
    if (!solicitudPago) return;
    setErrorTarjeta(null);
    setProcesandoTarjeta(true);
    try {
      const actualizada = await apiFetch<PaymentRequestDTO>(`/pagos/solicitudes/${solicitudPago.id}/iniciar-cobro`, { method: "POST" });
      setSolicitudPago(actualizada);
    } catch (e: any) {
      setErrorTarjeta(e.message ?? "No se pudo iniciar el cobro en la terminal");
    } finally {
      setProcesandoTarjeta(false);
    }
  }

  async function cancelarSolicitudTarjeta() {
    if (!solicitudPago) return;
    setProcesandoTarjeta(true);
    try {
      await apiFetch(`/pagos/solicitudes/${solicitudPago.id}/cancelar`, { method: "POST" });
      setSolicitudPago(null);
    } catch (e: any) {
      setErrorTarjeta(e.message);
    } finally {
      setProcesandoTarjeta(false);
    }
  }

  // Propina: por porcentaje rápido (10/15/20), personalizado (% o $ directo) — el importe manual
  // manda sobre el porcentaje si ambos están cargados.
  const [propinaPorcentaje, setPropinaPorcentaje] = useState(0);
  const [propinaPorcentajeTexto, setPropinaPorcentajeTexto] = useState("");
  const [propinaMontoTexto, setPropinaMontoTexto] = useState("");
  const propina = propinaMontoTexto !== "" ? Number(propinaMontoTexto) || 0 : round2(t.total * (propinaPorcentaje / 100));
  const totalAPagar = round2(t.total + propina);

  // Arranca en $0.00. El teclado ya no arma pagos parciales: es solo "con cuánto paga el
  // cliente", para calcular el cambio. Dejarlo en 0 significa importe exacto — ver `montoCobrado`.
  const [montoInput, setMontoInput] = useState("0");
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recibido = Number(montoInput || 0);
  const montoCobrado = recibido > 0 ? recibido : totalAPagar;
  const restante = Math.max(0, totalAPagar - montoCobrado);
  const cambio = Math.max(0, montoCobrado - totalAPagar);

  // Tarjeta/Transferencia/QR son montos exactos (no hay "cambio" que calcular, a diferencia de
  // efectivo) — se autocompletan con el total para no tener que teclearlo. Efectivo se deja en 0:
  // el cliente puede dar de más y hace falta calcular el cambio.
  function elegirMetodo(metodo: MetodoPago) {
    setMetodoActivo(metodo);
    setMontoInput(metodo === MetodoPago.EFECTIVO ? "0" : totalAPagar.toFixed(2));
  }

  function presionarTecla(tecla: string) {
    setMontoInput((m) => {
      if (tecla === "borrar") return m.length > 1 ? m.slice(0, -1) : "0";
      if (tecla === ".") return m.includes(".") ? m : `${m}.`;
      return m === "0" ? tecla : m + tecla;
    });
  }

  // Teclado físico de la PC (fila numérica o numpad) — funciona en cuanto se abre la ventana,
  // sin tener que hacerle clic al teclado en pantalla primero. Se ignora mientras el foco esté
  // en un <input>/<textarea> real (ej. "Porcentaje %", "Motivo" del descuento) para no duplicar
  // lo que se esté escribiendo ahí. Enter confirma el cobro y Esc cancela/cierra la ventana,
  // igual que el botón "Cancelar".
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
        // El pago con tarjeta tiene su propio flujo de botones (Cobrar con terminal / Iniciar
        // cobro) — Enter aquí no debe disparar `confirmar()`, que asume un monto tecleado a mano.
        if (!procesando && metodoActivo !== MetodoPago.TARJETA) confirmar();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCerrar();
      }
    }
    window.addEventListener("keydown", manejarTecladoFisico);
    return () => window.removeEventListener("keydown", manejarTecladoFisico);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [montoInput, restante, metodoActivo, procesando, propina, totalAPagar]);

  function elegirPropinaRapida(pct: number) {
    setPropinaPorcentaje(pct);
    setPropinaPorcentajeTexto("");
    setPropinaMontoTexto("");
  }

  async function confirmar() {
    setError(null);
    // Un solo pago con el método activo. Si el cajero no tecleó nada se cobra el total exacto:
    // es el caso mayoritario y ahorra teclear el importe que ya está en pantalla.
    const pagosFinales = [{ metodo: metodoActivo, monto: montoCobrado }];
    setProcesando(true);
    try {
      // Este negocio no tiene cocina — no hay un paso separado de "enviar pedido"; el pedido
      // se crea aquí mismo (si todavía no existe) y se cobra en el mismo toque de "Confirmar
      // pago". Al estar ya dentro del modal, cualquier error de esta creación se ve en pantalla
      // en vez de bloquear silenciosamente la apertura de la ventana de cobro.
      if (!pedidoId) await enviarACocina(mesaNombre);
      await cobrar(pagosFinales, mesaNombre);
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
      <div style={{ background: "var(--h421-white)", borderRadius: 20, width: "100%", maxWidth: 980, maxHeight: "92vh", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(11,30,51,0.3)" }}>
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

            <div style={{ borderTop: "1px solid var(--h421-gray-200)", marginTop: 10, paddingTop: 10, fontSize: 16, fontWeight: 700, color: "var(--h421-navy-texto)" }}>
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
                <button key={m.valor} onClick={() => elegirMetodo(m.valor)}
                  style={{ padding: "12px 16px", background: metodoActivo === m.valor ? "var(--h421-navy)" : "var(--h421-gray-50)", color: metodoActivo === m.valor ? "#fff" : "var(--h421-black)" }}>
                  {m.icono} {m.etiqueta}
                </button>
              ))}
            </div>

            <h4 style={{ marginBottom: 8, marginTop: 18 }}>Propina</h4>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={() => elegirPropinaRapida(0)}
                style={{ padding: "12px 16px", background: propina === 0 ? "var(--h421-navy)" : "var(--h421-gray-50)", color: propina === 0 ? "#fff" : "var(--h421-black)" }}>
                Sin propina
              </button>
              {PROPINAS_RAPIDAS.map((pct) => (
                <button key={pct} onClick={() => elegirPropinaRapida(pct)}
                  style={{ padding: "12px 16px", background: propinaMontoTexto === "" && propinaPorcentaje === pct ? "var(--h421-navy)" : "var(--h421-gray-50)", color: propinaMontoTexto === "" && propinaPorcentaje === pct ? "#fff" : "var(--h421-black)" }}>
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
              <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--h421-navy-texto)" }}>
                {t.descuentoTotal > 0
                  ? <>Aplicado: <strong>−${t.descuentoTotal.toFixed(2)}</strong> {descuentos[0]?.motivo ? `(${descuentos[0].motivo})` : ""}</>
                  : "Sin descuento aplicado."}
              </p>
              <button onClick={() => setMostrarDescuento(true)} style={{ padding: "8px 14px", fontSize: 13, background: "var(--h421-yellow)", color: "#000", flexShrink: 0 }}>
                {t.descuentoTotal > 0 ? "Cambiar" : "% Descuento"}
              </button>
            </div>
            <p style={{ margin: "4px 0 0", fontSize: 14, fontWeight: 700, color: "var(--h421-navy-texto)" }}>Requiere PIN de supervisor.</p>

            <div style={{ borderTop: "1px solid var(--h421-gray-200)", marginTop: 14, paddingTop: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 16, fontWeight: 700, color: "var(--h421-navy-texto)" }}>
                <span>Propina</span><span>${propina.toFixed(2)} MXN</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: 20 }}>
                <span>Total a pagar</span><span>${totalAPagar.toFixed(2)} MXN</span>
              </div>
              <p style={{ margin: "6px 0 0", fontSize: 19, fontWeight: 800 }}>
                {restante > 0
                  ? <span style={{ color: "var(--h421-navy-texto)" }}>Falta cubrir: ${restante.toFixed(2)}</span>
                  : <span style={{ color: "var(--h421-esmeralda)" }}>Cambio: ${cambio.toFixed(2)}</span>}
              </p>
            </div>

            {error && <p style={{ color: "var(--h421-red-texto)" }}>{error}</p>}

            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button onClick={onCerrar} style={{ flex: 1, padding: 14, background: "var(--h421-gray-200)" }}>Cancelar</button>
              {metodoActivo !== MetodoPago.TARJETA && (
                <button onClick={confirmar} disabled={procesando || restante > 0} className="btn-grande btn-pagar" style={{ flex: 2, fontSize: 16 }}>
                  {procesando ? "Procesando…" : "Confirmar pago"}
                </button>
              )}
            </div>
          </div>

          {/* Columna derecha: teclado numérico (Efectivo/Transferencia/QR) o el panel de cobro
              con terminal (Tarjeta) — son flujos distintos: el de tarjeta no agrega un pago
              manual, espera la confirmación real del proveedor antes de dar la cuenta por
              liquidada. */}
          {metodoActivo === MetodoPago.TARJETA ? (
            <div style={{ padding: 24, background: "var(--h421-gray-50)", display: "flex", flexDirection: "column" }}>
              <p style={{ margin: "0 0 8px", fontSize: 13, color: "var(--h421-gray-400)", textAlign: "center" }}>Monto a cobrar con tarjeta</p>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--h421-white)", borderRadius: 12, padding: "16px 20px", fontSize: 30, fontWeight: 800, border: "1px solid var(--h421-gray-200)" }}>
                <span>$</span>
                <span>{montoInput}</span>
              </div>

              {!solicitudPago && (
                <>
                  <p style={{ margin: "18px 0 6px", fontSize: 13, color: "var(--h421-gray-400)" }}>Terminal</p>
                  {terminales.length === 0 ? (
                    <p style={{ fontSize: 13, color: "var(--h421-red-texto)" }}>No hay terminales activas en esta sucursal — dalas de alta en Administración → Terminales de pago.</p>
                  ) : (
                    <select value={terminalId} onChange={(e) => setTerminalId(e.target.value)} style={{ padding: 10, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }}>
                      {terminales.map((tm) => <option key={tm.id} value={tm.id}>{tm.nombre}{tm.zona ? ` · ${tm.zona}` : ""}</option>)}
                    </select>
                  )}
                  <button onClick={crearSolicitudTarjeta} disabled={procesandoTarjeta || !terminalId || Number(montoInput) <= 0}
                    className="btn-grande" style={{ marginTop: 16, background: "var(--h421-navy)", color: "#fff", fontSize: 16 }}>
                    {procesandoTarjeta ? "Creando solicitud…" : "Cobrar con terminal"}
                  </button>
                </>
              )}

              {solicitudPago && (
                <div style={{ marginTop: 18, flex: 1, display: "flex", flexDirection: "column" }}>
                  <p style={{
                    fontSize: 16, fontWeight: 700, textAlign: "center", padding: "14px 10px", borderRadius: 10,
                    background: solicitudPago.estado === "APROBADO" ? "var(--h421-esmeralda)" : ESTADOS_FINALES_CON_ERROR.has(solicitudPago.estado) ? "var(--h421-red-bg)" : "var(--h421-white)",
                    color: solicitudPago.estado === "APROBADO" ? "#fff" : ESTADOS_FINALES_CON_ERROR.has(solicitudPago.estado) ? "var(--h421-red-texto)" : "var(--h421-navy-texto)",
                    border: "1px solid var(--h421-gray-200)",
                  }}>
                    {ETIQUETA_ESTADO_PAGO[solicitudPago.estado] ?? solicitudPago.estado}
                  </p>
                  {solicitudPago.motivoError && <p style={{ fontSize: 13, color: "var(--h421-red-texto)", textAlign: "center" }}>{solicitudPago.motivoError}</p>}

                  <div style={{ display: "flex", gap: 10, marginTop: "auto" }}>
                    {solicitudPago.estado === "PENDIENTE" && (
                      <button onClick={iniciarCobroEnTerminal} disabled={procesandoTarjeta} className="btn-grande" style={{ flex: 1, background: "var(--h421-navy)", color: "#fff" }}>
                        {procesandoTarjeta ? "Enviando…" : "Iniciar cobro en terminal"}
                      </button>
                    )}
                    {!ESTADOS_FINALES_CON_ERROR.has(solicitudPago.estado) && solicitudPago.estado !== "APROBADO" && (
                      <button onClick={cancelarSolicitudTarjeta} disabled={procesandoTarjeta} style={{ flex: 1, background: "var(--h421-gray-200)" }}>
                        Cancelar cobro
                      </button>
                    )}
                    {ESTADOS_FINALES_CON_ERROR.has(solicitudPago.estado) && (
                      <button onClick={() => setSolicitudPago(null)} className="btn-grande" style={{ flex: 1, background: "var(--h421-navy)", color: "#fff" }}>
                        Reintentar
                      </button>
                    )}
                  </div>
                </div>
              )}

              {errorTarjeta && <p style={{ color: "var(--h421-red-texto)", marginTop: 12 }}>{errorTarjeta}</p>}
            </div>
          ) : (
            <div style={{ padding: 24, background: "var(--h421-gray-50)", display: "flex", flexDirection: "column" }}>
              <p style={{ margin: "0 0 8px", fontSize: 13, color: "var(--h421-gray-400)", textAlign: "center" }}>Paga con (déjalo en 0 si es importe exacto)</p>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--h421-white)", borderRadius: 12, padding: "16px 20px", fontSize: 30, fontWeight: 800, border: "1px solid var(--h421-gray-200)" }}>
                <span>$</span>
                <span>{montoInput}</span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginTop: 16, flex: 1 }}>
                {TECLAS.map((k) => (
                  <button
                    key={k}
                    onClick={() => presionarTecla(k)}
                    style={{
                      fontSize: 22, fontWeight: 700, background: k === "borrar" ? "var(--h421-red-bg)" : "var(--h421-white)",
                      color: k === "borrar" ? "var(--h421-red-texto)" : "var(--h421-black)",
                      border: "1px solid var(--h421-gray-200)", minHeight: 56,
                    }}
                  >
                    {k === "borrar" ? "Borrar" : k}
                  </button>
                ))}
              </div>

              <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--h421-gray-400)", textAlign: "center" }}>
                Enter confirma el cobro · Esc cancela
              </p>
            </div>
          )}
        </div>
      </div>
    </div>

    {mostrarDescuento && (
      <ModalDescuento sucursalId={sucursalId} onCerrar={() => setMostrarDescuento(false)} />
    )}
    </>
  );
}
