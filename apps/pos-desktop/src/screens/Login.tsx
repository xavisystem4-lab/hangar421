import { useState } from "react";
import { useAuthStore } from "../store/authStore";

export function Login() {
  const { loginCredenciales, error } = useAuthStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [cargando, setCargando] = useState(false);

  async function entrar() {
    setCargando(true);
    try {
      await loginCredenciales(email, password);
    } catch {
      // el error ya queda reflejado en el store
    } finally {
      setCargando(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--h421-navy)" }}>
      <form
        onSubmit={(e) => { e.preventDefault(); entrar(); }}
        style={{ background: "#fff", padding: 40, borderRadius: 20, width: 380, textAlign: "center" }}
      >
        <h1 style={{ color: "var(--h421-navy)", letterSpacing: 1 }}>HANGAR 421</h1>
        <p style={{ color: "var(--h421-gray-400)", marginTop: -8 }}>Punto de venta</p>

        <input placeholder="Correo" value={email} onChange={(e) => setEmail(e.target.value)}
          style={{ width: "100%", padding: 14, marginTop: 20, borderRadius: 10, border: "1px solid var(--h421-gray-200)" }} />
        <input placeholder="Contraseña" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          style={{ width: "100%", padding: 14, marginTop: 10, borderRadius: 10, border: "1px solid var(--h421-gray-200)" }} />

        {error && <p style={{ color: "var(--h421-red)", fontSize: 13 }}>{error}</p>}

        <button type="submit" disabled={cargando} className="btn-grande"
          style={{ width: "100%", marginTop: 18, background: "var(--h421-green)", color: "#fff", fontSize: 16 }}>
          {cargando ? "Ingresando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
