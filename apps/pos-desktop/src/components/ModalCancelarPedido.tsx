import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../api/http";

interface UsuarioLogin { id: string; nombre: string; rol: string | null }

// Roles que pueden autorizar cancelar una cuenta — deben coincidir con ROLES_AUTORIZAN_CANCELACION
// en apps/backend/src/pedidos/pedidos.service.ts (el PIN se valida ahí, server-side).
const ROLES_AUTORIZAN = new Set(["SUPERVISOR", "ADMIN_SUCURSAL", "ADMIN_CORPORATIVO"]);
const ETIQUETA_ROL: Record<string, string> = {
  ADMIN_CORPORATIVO: "Admin. corporativo", ADMIN_SUCURSAL: "Admin. sucursal", SUPERVISOR: "Supervisor",
};

const inputStyle = { width: "100%", padding: 10, marginTop: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" } as const;

/** Cancelar una cuenta ya enviada — requiere PIN de un Supervisor/Admin, verificado en el
 *  servidor (POST /pedidos/:id/cancelar ya no exige que la sesión del POS misma sea admin: el
 *  cajero puede estar logueado y de todos modos cancelar, siempre que teclee el PIN correcto de
 *  alguien autorizado). Mismo patrón de UI que ModalDescuento. */
export function ModalCancelarPedido({
  pedidoId,
  sucursalId,
  etiqueta,
  onCerrar,
  onCancelado,
}: {
  pedidoId: string;
  sucursalId: string;
  etiqueta: string;
  onCerrar: () => void;
  onCancelado: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [autorizadores, setAutorizadores] = useState<UsuarioLogin[] | null>(null);
  const [usuarioAutorizaId, setUsuarioAutorizaId] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [procesando, setProcesando] = useState(false);

  const motivoRef = useRef<HTMLInputElement>(null);
  const pinRef = useRef<HTMLInputElement>(null);

  function irA(campo: React.RefObject<HTMLInputElement>) {
    campo.current?.focus();
    campo.current?.select();
  }
  function manejarNavegacion(e: React.KeyboardEvent<HTMLInputElement>, siguiente?: React.RefObject<HTMLInputElement>, anterior?: React.RefObject<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      if (siguiente) irA(siguiente);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (anterior) irA(anterior);
    }
  }

  useEffect(() => {
    apiFetch<UsuarioLogin[]>(`/auth/usuarios-login?sucursalId=${encodeURIComponent(sucursalId)}`)
      .then((usuarios) => setAutorizadores(usuarios.filter((u) => u.rol && ROLES_AUTORIZAN.has(u.rol))))
      .catch(() => setAutorizadores([]));
  }, [sucursalId]);

  async function confirmar() {
    setError(null);
    if (!motivo.trim()) return setError("Indica el motivo de la cancelación");
    if (!usuarioAutorizaId) return setError("Elige quién autoriza la cancelación");
    if (!pin.trim()) return setError("Indica el PIN de autorización");
    setProcesando(true);
    try {
      await apiFetch(`/pedidos/${pedidoId}/cancelar`, {
        method: "POST",
        body: JSON.stringify({ motivo, autorizadoPorId: usuarioAutorizaId, pin }),
      });
      onCancelado();
    } catch (e: any) {
      setError(e.message ?? "No se pudo cancelar la cuenta");
    } finally {
      setProcesando(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 }}>
      <div style={{ background: "var(--h421-white)", borderRadius: 16, padding: 24, width: 380, maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Cancelar cuenta</h2>
          <button onClick={onCerrar} style={{ background: "none", fontSize: 20 }}>✕</button>
        </div>
        <p style={{ margin: "4px 0 0", fontSize: 14, color: "var(--h421-gray-400)" }}>{etiqueta}</p>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--h421-red-texto)" }}>
          Esta acción cancela la cuenta por completo (no se podrá cobrar después) y libera la mesa.
        </p>

        <input ref={motivoRef} placeholder="Motivo de la cancelación (obligatorio)" value={motivo} onChange={(e) => setMotivo(e.target.value)}
          onKeyDown={(e) => manejarNavegacion(e, pinRef)}
          style={inputStyle} />

        <div style={{ marginTop: 14, padding: 10, background: "var(--h421-gray-50)", borderRadius: 8 }}>
          <strong style={{ fontSize: 13 }}>Autorización de supervisor</strong>

          {autorizadores === null && <p style={{ fontSize: 13, color: "var(--h421-gray-400)", marginBottom: 0 }}>Cargando…</p>}
          {autorizadores?.length === 0 && <p style={{ fontSize: 13, color: "var(--h421-red-texto)", marginBottom: 0 }}>No hay usuarios con rol de supervisor o admin dados de alta.</p>}

          {autorizadores && autorizadores.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
              {autorizadores.map((u) => {
                const activo = usuarioAutorizaId === u.id;
                return (
                  <button
                    key={u.id}
                    onClick={() => setUsuarioAutorizaId(u.id)}
                    style={{
                      padding: "8px 12px", fontSize: 13, minHeight: 40,
                      background: activo ? "var(--h421-navy)" : "var(--h421-white)",
                      color: activo ? "#fff" : "var(--h421-black)",
                      border: "1px solid var(--h421-gray-200)",
                    }}
                  >
                    {u.nombre}{u.rol ? ` · ${ETIQUETA_ROL[u.rol] ?? u.rol}` : ""}
                  </button>
                );
              })}
            </div>
          )}

          <input ref={pinRef} placeholder="PIN" type="password" value={pin} onChange={(e) => setPin(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); if (!procesando) confirmar(); }
              else if (e.key === "ArrowUp") { e.preventDefault(); irA(motivoRef); }
            }}
            style={{ width: "100%", padding: 10, marginTop: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
        </div>

        {error && <p style={{ color: "var(--h421-red-texto)" }}>{error}</p>}

        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button onClick={onCerrar} style={{ flex: 1, padding: 14, background: "var(--h421-gray-200)" }}>Volver</button>
          <button onClick={confirmar} disabled={procesando} className="btn-grande" style={{ flex: 2, background: "var(--h421-red)", color: "#fff" }}>
            {procesando ? "Cancelando…" : "Cancelar cuenta"}
          </button>
        </div>
      </div>
    </div>
  );
}
