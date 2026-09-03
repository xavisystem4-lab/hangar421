import { useEffect, useState } from "react";
import { TipoDescuento } from "@hangar421/shared";
import { apiFetch } from "../api/http";
import { useOrderStore } from "../store/orderStore";

interface UsuarioLogin { id: string; nombre: string; rol: string | null }

// Roles que pueden autorizar un descuento (deben coincidir con los que acepta el backend en
// POST /pedidos/:id/descuentos — ver `@Roles` en pedidos.controller.ts).
const ROLES_AUTORIZAN = new Set(["SUPERVISOR", "ADMIN_SUCURSAL", "ADMIN_CORPORATIVO"]);
const ETIQUETA_ROL: Record<string, string> = {
  ADMIN_CORPORATIVO: "Admin. corporativo", ADMIN_SUCURSAL: "Admin. sucursal", SUPERVISOR: "Supervisor",
};

/** Descuento con autorización: requiere el PIN de un Supervisor/Admin — se valida contra
 *  /auth/login-pin (sin cambiar la sesión activa, solo para confirmar identidad y rol). El
 *  cajero elige el nombre de una lista en vez de tener que teclear el ID del usuario a mano. */
export function ModalDescuento({ sucursalId, onCerrar }: { sucursalId: string; onCerrar: () => void }) {
  const { aplicarDescuento } = useOrderStore();
  const [tipo, setTipo] = useState<TipoDescuento>(TipoDescuento.PORCENTAJE);
  // Arranca en cero — nunca se aplica un descuento "por accidente" si el cajero abre el modal
  // y confirma sin querer; hay que escribir el valor explícitamente.
  const [valor, setValor] = useState("0");
  const [motivo, setMotivo] = useState("");
  const [autorizadores, setAutorizadores] = useState<UsuarioLogin[] | null>(null);
  const [usuarioAutorizaId, setUsuarioAutorizaId] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [validando, setValidando] = useState(false);

  useEffect(() => {
    // Filtrado por `sucursalId` en el propio backend: solo trae usuarios con acceso a ESTA
    // sucursal — antes se pedía la lista completa (sin filtro) y podía mostrar a alguien cuya
    // única sucursal asignada fuera otra; elegirlo hacía que /auth/login-pin lo rechazara con
    // "sin acceso a la sucursal" sin importar el PIN que se tecleara.
    apiFetch<UsuarioLogin[]>(`/auth/usuarios-login?sucursalId=${encodeURIComponent(sucursalId)}`)
      .then((usuarios) => setAutorizadores(usuarios.filter((u) => u.rol && ROLES_AUTORIZAN.has(u.rol))))
      .catch(() => setAutorizadores([]));
  }, [sucursalId]);

  async function confirmar() {
    setError(null);
    if (!(Number(valor) > 0)) return setError("Indica el valor del descuento (mayor a cero)");
    if (!motivo.trim()) return setError("Indica el motivo del descuento");
    if (!usuarioAutorizaId) return setError("Elige quién autoriza el descuento");
    setValidando(true);
    try {
      // valida que el PIN corresponda a un usuario con permiso en esta sucursal
      await apiFetch("/auth/login-pin", {
        method: "POST",
        body: JSON.stringify({ usuarioId: usuarioAutorizaId, pin, sucursalId, dispositivoId: "validacion-descuento" }),
      });
      aplicarDescuento({ tipo, valor: Number(valor), motivo, autorizadoPorId: usuarioAutorizaId });
      onCerrar();
    } catch (e: any) {
      // Antes tapaba cualquier error con "PIN de autorización inválido" — si la causa real era
      // otra (sin acceso a la sucursal, PIN no configurado, etc.) parecía que NINGÚN PIN
      // funcionaba nunca. Ahora se muestra el motivo real que manda el backend.
      setError(e.message ?? "PIN de autorización inválido");
    } finally {
      setValidando(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 24, width: 380, maxHeight: "90vh", overflowY: "auto" }}>
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

          {autorizadores === null && <p style={{ fontSize: 13, color: "var(--h421-gray-400)", marginBottom: 0 }}>Cargando…</p>}
          {autorizadores?.length === 0 && <p style={{ fontSize: 13, color: "var(--h421-red)", marginBottom: 0 }}>No hay usuarios con rol de supervisor o admin dados de alta.</p>}

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
                      background: activo ? "var(--h421-navy)" : "#fff",
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

          <input placeholder="PIN" type="password" value={pin} onChange={(e) => setPin(e.target.value)}
            style={{ width: "100%", padding: 10, marginTop: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
        </div>

        {error && <p style={{ color: "var(--h421-red)" }}>{error}</p>}

        {/* Cancelar cierra sin tocar nada — no se aplica ni se resta ningún descuento. */}
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button onClick={onCerrar} style={{ flex: 1, padding: 14, background: "var(--h421-gray-200)" }}>Cancelar</button>
          <button onClick={confirmar} disabled={validando} className="btn-grande" style={{ flex: 2, background: "var(--h421-yellow)", color: "#000" }}>
            {validando ? "Validando…" : "Aplicar descuento"}
          </button>
        </div>
      </div>
    </div>
  );
}
