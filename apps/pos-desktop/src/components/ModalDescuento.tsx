import { useState } from "react";
import { TipoDescuento } from "@hangar421/shared";
import { apiFetch } from "../api/http";
import { useOrderStore } from "../store/orderStore";

/** Descuento con autorización: requiere el PIN de un Supervisor/Admin — se valida contra
 *  /auth/login-pin (sin cambiar la sesión activa, solo para confirmar identidad y rol). */
export function ModalDescuento({ sucursalId, onCerrar }: { sucursalId: string; onCerrar: () => void }) {
  const { aplicarDescuento } = useOrderStore();
  const [tipo, setTipo] = useState<TipoDescuento>(TipoDescuento.PORCENTAJE);
  const [valor, setValor] = useState("10");
  const [motivo, setMotivo] = useState("");
  const [usuarioAutorizaId, setUsuarioAutorizaId] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [validando, setValidando] = useState(false);

  async function confirmar() {
    setError(null);
    if (!motivo.trim()) return setError("Indica el motivo del descuento");
    setValidando(true);
    try {
      // valida que el PIN corresponda a un usuario con permiso en esta sucursal
      await apiFetch("/auth/login-pin", {
        method: "POST",
        body: JSON.stringify({ usuarioId: usuarioAutorizaId, pin, sucursalId, dispositivoId: "validacion-descuento" }),
      });
      aplicarDescuento({ tipo, valor: Number(valor), motivo, autorizadoPorId: usuarioAutorizaId });
      onCerrar();
    } catch {
      setError("PIN de autorización inválido");
    } finally {
      setValidando(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 24, width: 380 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Aplicar descuento</h2>
          <button onClick={onCerrar} style={{ background: "none", fontSize: 20 }}>✕</button>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button onClick={() => setTipo(TipoDescuento.PORCENTAJE)} style={{ flex: 1, background: tipo === TipoDescuento.PORCENTAJE ? "var(--h421-navy)" : "var(--h421-gray-50)", color: tipo === TipoDescuento.PORCENTAJE ? "#fff" : "#000" }}>%</button>
          <button onClick={() => setTipo(TipoDescuento.MONTO)} style={{ flex: 1, background: tipo === TipoDescuento.MONTO ? "var(--h421-navy)" : "var(--h421-gray-50)", color: tipo === TipoDescuento.MONTO ? "#fff" : "#000" }}>$</button>
          <input type="number" value={valor} onChange={(e) => setValor(e.target.value)} style={{ flex: 2, padding: 10, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
        </div>

        <input placeholder="Motivo (obligatorio)" value={motivo} onChange={(e) => setMotivo(e.target.value)}
          style={{ width: "100%", padding: 10, marginTop: 10, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />

        <div style={{ marginTop: 14, padding: 10, background: "var(--h421-gray-50)", borderRadius: 8 }}>
          <strong style={{ fontSize: 13 }}>Autorización de supervisor</strong>
          <input placeholder="ID de usuario autoriza" value={usuarioAutorizaId} onChange={(e) => setUsuarioAutorizaId(e.target.value)}
            style={{ width: "100%", padding: 10, marginTop: 6, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
          <input placeholder="PIN" type="password" value={pin} onChange={(e) => setPin(e.target.value)}
            style={{ width: "100%", padding: 10, marginTop: 6, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
        </div>

        {error && <p style={{ color: "var(--h421-red)" }}>{error}</p>}

        <button onClick={confirmar} disabled={validando} className="btn-grande" style={{ width: "100%", marginTop: 16, background: "var(--h421-yellow)", color: "#000" }}>
          {validando ? "Validando…" : "Aplicar descuento"}
        </button>
      </div>
    </div>
  );
}
