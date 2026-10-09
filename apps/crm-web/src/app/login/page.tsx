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
  const [verPassword, setVerPassword] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setCargando(true);
    try {
      await login(email.trim(), password);
      router.replace("/dashboard");
    } catch {
      // el error se refleja desde el store
    } finally {
      setCargando(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--h421-navy)", padding: 16 }}>
      {/* Tarjeta de marca con colores fijos (no var(--h421-white)/--h421-black, que cambian con
          el modo oscuro) — antes en modo oscuro la tarjeta se oscurecía pero el logo (siempre
          texto azul marino oscuro, pensado para fondo claro) se volvía casi invisible sobre ella.
          Un login de marca no debe seguir la preferencia de tema del usuario, igual que
          pos-desktop/Login.tsx. */}
      {/* width: 100% con tope de 380: en un celular la tarjeta de 380 fijos se salía de la
          pantalla y el botón quedaba fuera de alcance. */}
      <form onSubmit={entrar} style={{ width: "100%", maxWidth: 380, textAlign: "center", background: "#ffffff", borderRadius: 14, padding: 28, boxShadow: "0 10px 40px rgba(0,0,0,0.35)", boxSizing: "border-box" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="HANGAR 421" style={{ height: 64, width: "auto", margin: "0 auto" }} />
        <p style={{ color: "#6b7280", marginTop: 10 }}>ERP corporativo</p>

        {/* Sin autocorrección ni mayúscula automática: el teclado del celular convertía "galaviz"
            en "Galaviz" y el acceso fallaba. inputMode=email evita además el teclado con
            autocompletado agresivo; fontSize 16 impide que iOS haga zoom al enfocar. */}
        <input
          placeholder="Correo o usuario"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="username"
          inputMode="email"
          style={{ width: "100%", padding: 12, marginTop: 16, borderRadius: 10, border: "1px solid #e5e7eb", background: "#fff", color: "#111318", fontSize: 16, boxSizing: "border-box" }}
        />
        <div style={{ position: "relative", marginTop: 10 }}>
          <input
            placeholder="Contraseña"
            type={verPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="current-password"
            style={{ width: "100%", padding: 12, paddingRight: 44, borderRadius: 10, border: "1px solid #e5e7eb", background: "#fff", color: "#111318", fontSize: 16, boxSizing: "border-box" }}
          />
          <button type="button" onClick={() => setVerPassword((v) => !v)} aria-label={verPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
            style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", color: "#6b7280", padding: "6px 8px", fontSize: 16 }}>
            {verPassword ? "🙈" : "👁"}
          </button>
        </div>

        {error && <p style={{ color: "#dc2626", fontSize: 13 }}>{error}</p>}

        <button disabled={cargando} style={{ width: "100%", marginTop: 16, padding: 14, background: "var(--h421-green)", color: "#fff", fontSize: 16 }}>
          {cargando ? "Ingresando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
