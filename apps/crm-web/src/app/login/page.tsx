"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthCrm } from "@/lib/authClient";

export default function LoginPage() {
  const router = useRouter();
  const { login, error } = useAuthCrm();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [cargando, setCargando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setCargando(true);
    try {
      await login(email, password);
      router.replace("/dashboard");
    } catch {
      // el error se refleja desde el store
    } finally {
      setCargando(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--h421-navy)" }}>
      <form onSubmit={entrar} className="card" style={{ width: 380, textAlign: "center" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="HANGAR 421" style={{ height: 40, width: "auto", margin: "0 auto" }} />
        <p style={{ color: "var(--h421-gray-400)", marginTop: 8 }}>CRM corporativo</p>

        <input placeholder="Correo" value={email} onChange={(e) => setEmail(e.target.value)}
          style={{ width: "100%", padding: 12, marginTop: 16, borderRadius: 10, border: "1px solid var(--h421-gray-200)" }} />
        <input placeholder="Contraseña" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          style={{ width: "100%", padding: 12, marginTop: 10, borderRadius: 10, border: "1px solid var(--h421-gray-200)" }} />

        {error && <p style={{ color: "var(--h421-red)", fontSize: 13 }}>{error}</p>}

        <button disabled={cargando} style={{ width: "100%", marginTop: 16, padding: 14, background: "var(--h421-green)", color: "#fff", fontSize: 16 }}>
          {cargando ? "Ingresando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
