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
      {/* Tarjeta de marca con colores fijos (no var(--h421-white)/--h421-black, que cambian con
          el modo oscuro) — antes en modo oscuro la tarjeta se oscurecía pero el logo (siempre
          texto azul marino oscuro, pensado para fondo claro) se volvía casi invisible sobre ella.
          Un login de marca no debe seguir la preferencia de tema del usuario, igual que
          pos-desktop/Login.tsx. */}
      <form onSubmit={entrar} style={{ width: 380, textAlign: "center", background: "#ffffff", borderRadius: 14, padding: 32, boxShadow: "0 10px 40px rgba(0,0,0,0.35)" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="HANGAR 421" style={{ height: 64, width: "auto", margin: "0 auto" }} />
        <p style={{ color: "#6b7280", marginTop: 10 }}>CRM corporativo</p>

        <input placeholder="Correo o usuario" value={email} onChange={(e) => setEmail(e.target.value)}
          style={{ width: "100%", padding: 12, marginTop: 16, borderRadius: 10, border: "1px solid #e5e7eb", background: "#fff", color: "#111318" }} />
        <input placeholder="Contraseña" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          style={{ width: "100%", padding: 12, marginTop: 10, borderRadius: 10, border: "1px solid #e5e7eb", background: "#fff", color: "#111318" }} />

        {error && <p style={{ color: "#dc2626", fontSize: 13 }}>{error}</p>}

        <button disabled={cargando} style={{ width: "100%", marginTop: 16, padding: 14, background: "var(--h421-green)", color: "#fff", fontSize: 16 }}>
          {cargando ? "Ingresando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
