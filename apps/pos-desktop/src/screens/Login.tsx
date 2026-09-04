import { useEffect, useState } from "react";
import { apiFetch } from "../api/http";
import { useAuthStore } from "../store/authStore";
import { useThemeStore } from "../store/themeStore";
import logoOscuro from "../assets/logo-dark.png";
import logoClaro from "../assets/logo-light.png";
import fondo from "../assets/login-fondo.jpg";

interface UsuarioLogin {
  id: string;
  nombre: string;
  email: string;
  rol: string | null;
  sucursalId: string | null;
}

const ETIQUETA_ROL: Record<string, string> = {
  ADMIN_CORPORATIVO: "Admin. corporativo",
  ADMIN_SUCURSAL: "Admin. sucursal",
  CAJERO: "Cajero",
  MESERO: "Mesero",
  COCINA: "Cocina",
  SUPERVISOR: "Supervisor",
};

function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/);
  return ((partes[0]?.[0] ?? "") + (partes[1]?.[0] ?? "")).toUpperCase();
}

export function Login() {
  const { loginCredenciales, error } = useAuthStore();
  const { tema, alternar } = useThemeStore();
  // Vela el fondo con blanco en modo claro (aclara la foto) y con navy en modo oscuro
  // (la oscurece) — así la pantalla de login se siente coherente con el tema elegido.
  const velo = tema === "oscuro" ? "rgba(11,30,51,0.65)" : "rgba(255,255,255,0.45)";
  const [usuarios, setUsuarios] = useState<UsuarioLogin[] | null>(null);
  const [errorUsuarios, setErrorUsuarios] = useState<string | null>(null);
  const [seleccionado, setSeleccionado] = useState<UsuarioLogin | null>(null);
  const [password, setPassword] = useState("");
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    apiFetch<UsuarioLogin[]>("/auth/usuarios-login")
      .then(setUsuarios)
      .catch((e) => setErrorUsuarios(e.message ?? "No se pudo cargar la lista de usuarios"));
  }, []);

  async function entrar() {
    if (!seleccionado) return;
    setCargando(true);
    try {
      await loginCredenciales(seleccionado.email, password, seleccionado.sucursalId ?? undefined);
    } catch {
      // el error ya queda reflejado en el store
    } finally {
      setCargando(false);
    }
  }

  return (
    <div
      style={{
        height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
        position: "relative",
        background: `linear-gradient(${velo}, ${velo}), url(${fondo}) center/cover no-repeat`,
      }}
    >
      <button
        onClick={alternar}
        title={tema === "oscuro" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
        style={{
          position: "absolute", top: 20, right: 24, width: 44, height: 44, minHeight: 0, padding: 0,
          borderRadius: 22, background: "var(--h421-white)", color: "var(--h421-black)", fontSize: 20,
          display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 14px rgba(11,30,51,0.18)",
        }}
      >
        {tema === "oscuro" ? "☀️" : "🌙"}
      </button>
      <div style={{ width: "100%", maxWidth: 920, background: "var(--h421-white)", borderRadius: 24, boxShadow: "0 20px 60px rgba(11,30,51,0.18)", padding: "36px 44px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
        <img src={tema === "oscuro" ? logoClaro : logoOscuro} alt="HANGAR 421" style={{ height: 44, width: "auto", marginBottom: 6 }} />
        <p style={{ color: "var(--h421-gray-400)", margin: 0, fontSize: 14 }}>Elige tu usuario para entrar</p>

        {errorUsuarios && <p style={{ color: "var(--h421-red)" }}>{errorUsuarios}</p>}
        {!usuarios && !errorUsuarios && <p style={{ color: "var(--h421-gray-400)" }}>Cargando usuarios…</p>}

        {usuarios && (
          <div style={{ width: "100%", display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 12, marginTop: 12 }}>
            {usuarios.map((u) => {
              const activo = seleccionado?.id === u.id;
              return (
                <button
                  key={u.id}
                  onClick={() => setSeleccionado(u)}
                  className="btn-grande"
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 6, width: 108,
                    background: activo ? "var(--h421-navy)" : "var(--h421-gray-50)",
                    borderRadius: 14, padding: "14px 6px",
                    outline: activo ? "2px solid var(--h421-amber)" : "none",
                    outlineOffset: 2,
                  }}
                >
                  <span style={{
                    width: 48, height: 48, borderRadius: 24, background: "var(--h421-amber)", color: "var(--h421-navy)",
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, fontWeight: 800,
                  }}>
                    {iniciales(u.nombre)}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: activo ? "#fff" : "var(--h421-black)", textAlign: "center", lineHeight: 1.2 }}>
                    {u.nombre}
                  </span>
                  {u.rol && <span style={{ fontSize: 10, color: activo ? "rgba(255,255,255,0.65)" : "var(--h421-gray-400)" }}>{ETIQUETA_ROL[u.rol] ?? u.rol}</span>}
                </button>
              );
            })}
          </div>
        )}

        <form
          onSubmit={(e) => { e.preventDefault(); entrar(); }}
          style={{ width: "100%", maxWidth: 340, marginTop: 22, paddingTop: 20, borderTop: "1px solid var(--h421-gray-200)", display: "flex", flexDirection: "column", alignItems: "stretch", gap: 10 }}
        >
          <p style={{ margin: 0, fontSize: 13, color: "var(--h421-gray-400)", textAlign: "center" }}>
            {seleccionado ? <>Contraseña de <strong style={{ color: "var(--h421-black)" }}>{seleccionado.nombre}</strong></> : "Elige tu usuario arriba"}
          </p>
          <input
            placeholder="Contraseña"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={!seleccionado}
            style={{ width: "100%", padding: 14, borderRadius: 10, border: "1px solid var(--h421-gray-200)" }}
          />

          {error && <p style={{ color: "var(--h421-red)", fontSize: 13, textAlign: "center", margin: 0 }}>{error}</p>}

          <button type="submit" disabled={cargando || !seleccionado} className="btn-grande"
            style={{ width: "100%", background: "var(--h421-esmeralda)", color: "#fff", fontSize: 16, opacity: seleccionado ? 1 : 0.5 }}>
            {cargando ? "Ingresando…" : "Entrar"}
          </button>
        </form>
      </div>
    </div>
  );
}
