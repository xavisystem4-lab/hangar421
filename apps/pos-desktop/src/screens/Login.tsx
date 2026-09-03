import { useEffect, useState } from "react";
import { apiFetch } from "../api/http";
import { useAuthStore } from "../store/authStore";
import logo from "../assets/logo-dark.png";

interface UsuarioLogin {
  id: string;
  nombre: string;
  email: string;
  rol: string | null;
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
      await loginCredenciales(seleccionado.email, password);
    } catch {
      // el error ya queda reflejado en el store
    } finally {
      setCargando(false);
    }
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "var(--h421-navy)", padding: 24, gap: 28 }}>
      <img src={logo} alt="HANGAR 421" style={{ height: 52, width: "auto" }} />

      {!seleccionado && (
        <div style={{ width: "100%", maxWidth: 720, textAlign: "center" }}>
          <p style={{ color: "rgba(255,255,255,0.7)", marginBottom: 18, fontSize: 15 }}>Elige tu usuario para entrar</p>

          {errorUsuarios && <p style={{ color: "var(--h421-red)" }}>{errorUsuarios}</p>}
          {!usuarios && !errorUsuarios && <p style={{ color: "rgba(255,255,255,0.7)" }}>Cargando usuarios…</p>}

          {usuarios && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 14 }}>
              {usuarios.map((u) => (
                <button
                  key={u.id}
                  onClick={() => setSeleccionado(u)}
                  className="btn-grande"
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
                    background: "#fff", borderRadius: 16, padding: "18px 10px",
                  }}
                >
                  <span style={{
                    width: 56, height: 56, borderRadius: 28, background: "var(--h421-amber)", color: "var(--h421-navy)",
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 800,
                  }}>
                    {iniciales(u.nombre)}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--h421-black)", textAlign: "center" }}>{u.nombre}</span>
                  {u.rol && <span style={{ fontSize: 11, color: "var(--h421-gray-400)" }}>{ETIQUETA_ROL[u.rol] ?? u.rol}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {seleccionado && (
        <form
          onSubmit={(e) => { e.preventDefault(); entrar(); }}
          style={{ background: "#fff", padding: 40, borderRadius: 20, width: 380, textAlign: "center" }}
        >
          <button
            type="button"
            onClick={() => { setSeleccionado(null); setPassword(""); }}
            style={{ background: "none", color: "var(--h421-gray-400)", fontSize: 13, padding: 0, marginBottom: 8 }}
          >
            ‹ Cambiar de usuario
          </button>

          <span style={{
            width: 64, height: 64, borderRadius: 32, background: "var(--h421-amber)", color: "var(--h421-navy)",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 800, margin: "0 auto",
          }}>
            {iniciales(seleccionado.nombre)}
          </span>
          <p style={{ fontWeight: 700, fontSize: 17, marginTop: 10, marginBottom: 0 }}>{seleccionado.nombre}</p>
          {seleccionado.rol && <p style={{ color: "var(--h421-gray-400)", fontSize: 13, marginTop: 2 }}>{ETIQUETA_ROL[seleccionado.rol] ?? seleccionado.rol}</p>}

          <input
            autoFocus
            placeholder="Contraseña"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ width: "100%", padding: 14, marginTop: 16, borderRadius: 10, border: "1px solid var(--h421-gray-200)" }}
          />

          {error && <p style={{ color: "var(--h421-red)", fontSize: 13 }}>{error}</p>}

          <button type="submit" disabled={cargando} className="btn-grande"
            style={{ width: "100%", marginTop: 18, background: "var(--h421-esmeralda)", color: "#fff", fontSize: 16 }}>
            {cargando ? "Ingresando…" : "Entrar"}
          </button>
        </form>
      )}
    </div>
  );
}
