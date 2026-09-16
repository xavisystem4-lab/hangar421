import { useEffect, useRef, useState } from "react";
import { TipoDescuento } from "@hangar421/shared";
import { apiFetch } from "../api/http";
import { useOrderStore } from "../store/orderStore";

interface UsuarioLogin { id: string; nombre: string; rol: string | null }

// Roles que pueden autorizar un descuento (deben coincidir con ROLES_AUTORIZAN_SUPERVISOR en
// apps/backend/src/pedidos/pedidos.service.ts — la contraseña se valida ahí, server-side).
const ROLES_AUTORIZAN = new Set(["SUPERVISOR", "ADMIN_SUCURSAL", "ADMIN_CORPORATIVO"]);
const ETIQUETA_ROL: Record<string, string> = {
  ADMIN_CORPORATIVO: "Admin. corporativo", ADMIN_SUCURSAL: "Admin. sucursal", SUPERVISOR: "Supervisor",
};

/** Descuento con autorización: requiere la CONTRASEÑA de un Supervisor/Admin (no el PIN de 4
 *  dígitos — aplicar un descuento es más consecuente que iniciar sesión rápido). Se valida
 *  server-side dentro de POST /pedidos/:id/descuentos (ver PedidosService.aplicarDescuento) en
 *  el momento en que el descuento realmente se manda (enviarACocina), no aquí — este modal solo
 *  lo captura. El cajero elige el nombre de una lista en vez de tener que teclear el ID a mano. */
export function ModalDescuento({ sucursalId, onCerrar }: { sucursalId: string; onCerrar: () => void }) {
  const { aplicarDescuento } = useOrderStore();
  const [tipo, setTipo] = useState<TipoDescuento>(TipoDescuento.PORCENTAJE);
  // Arranca en cero — nunca se aplica un descuento "por accidente" si el cajero abre el modal
  // y confirma sin querer; hay que escribir el valor explícitamente.
  const [valor, setValor] = useState("0");
  const [motivo, setMotivo] = useState("");
  const [autorizadores, setAutorizadores] = useState<UsuarioLogin[] | null>(null);
  const [usuarioAutorizaId, setUsuarioAutorizaId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const valorRef = useRef<HTMLInputElement>(null);
  const motivoRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Navegación entre campos con ↓/Enter (avanza) y ↑ (retrocede) — en un teclado físico junto a la
  // pantalla táctil es más rápido que usar el mouse/Tab. En el input numérico "valor" esto también
  // evita el comportamiento nativo de ↑/↓ de incrementar/decrementar el número.
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
    // Filtrado por `sucursalId` en el propio backend: solo trae usuarios con acceso a ESTA
    // sucursal — antes se pedía la lista completa (sin filtro) y podía mostrar a alguien cuya
    // única sucursal asignada fuera otra.
    apiFetch<UsuarioLogin[]>(`/auth/usuarios-login?sucursalId=${encodeURIComponent(sucursalId)}`)
      .then((usuarios) => setAutorizadores(usuarios.filter((u) => u.rol && ROLES_AUTORIZAN.has(u.rol))))
      .catch(() => setAutorizadores([]));
  }, [sucursalId]);

  // No hay una validación previa aquí (a diferencia de antes, con /auth/login-pin): la
  // contraseña se valida server-side recién cuando el descuento se manda de verdad (ver
  // orderStore.enviarACocina) — si es incorrecta, el error real aparece hasta ese momento
  // (en la pantalla de cobro), no aquí. Se documenta así para no sorprender al leer el flujo.
  function confirmar() {
    setError(null);
    if (!(Number(valor) > 0)) return setError("Indica el valor del descuento (mayor a cero)");
    if (!motivo.trim()) return setError("Indica el motivo del descuento");
    if (!usuarioAutorizaId) return setError("Elige quién autoriza el descuento");
    if (!password.trim()) return setError("Indica la contraseña de autorización");
    aplicarDescuento({ tipo, valor: Number(valor), motivo, autorizadoPorId: usuarioAutorizaId, password });
    onCerrar();
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
      <div style={{ background: "var(--h421-white)", borderRadius: 16, padding: 24, width: 380, maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Aplicar descuento</h2>
          <button onClick={onCerrar} style={{ background: "none", fontSize: 20 }}>✕</button>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button onClick={() => setTipo(TipoDescuento.PORCENTAJE)} style={{ flex: 1, background: tipo === TipoDescuento.PORCENTAJE ? "var(--h421-navy)" : "var(--h421-gray-50)", color: tipo === TipoDescuento.PORCENTAJE ? "#fff" : "var(--h421-black)" }}>%</button>
          <button onClick={() => setTipo(TipoDescuento.MONTO)} style={{ flex: 1, background: tipo === TipoDescuento.MONTO ? "var(--h421-navy)" : "var(--h421-gray-50)", color: tipo === TipoDescuento.MONTO ? "#fff" : "var(--h421-black)" }}>$</button>
          <input ref={valorRef} type="number" value={valor} onChange={(e) => setValor(e.target.value)}
            onKeyDown={(e) => manejarNavegacion(e, motivoRef)}
            style={{ flex: 2, padding: 10, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
        </div>

        <input ref={motivoRef} placeholder="Motivo (obligatorio)" value={motivo} onChange={(e) => setMotivo(e.target.value)}
          onKeyDown={(e) => manejarNavegacion(e, passwordRef, valorRef)}
          style={{ width: "100%", padding: 10, marginTop: 10, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />

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

          <input ref={passwordRef} placeholder="Contraseña" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); confirmar(); }
              else if (e.key === "ArrowUp") { e.preventDefault(); irA(motivoRef); }
            }}
            style={{ width: "100%", padding: 10, marginTop: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
        </div>

        {error && <p style={{ color: "var(--h421-red-texto)" }}>{error}</p>}

        {/* Cancelar cierra sin tocar nada — no se aplica ni se resta ningún descuento. */}
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button onClick={onCerrar} style={{ flex: 1, padding: 14, background: "var(--h421-gray-200)" }}>Cancelar</button>
          <button onClick={confirmar} className="btn-grande" style={{ flex: 2, background: "var(--h421-yellow)", color: "#000" }}>
            Aplicar descuento
          </button>
        </div>
      </div>
    </div>
  );
}
