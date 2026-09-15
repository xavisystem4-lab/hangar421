import logoClaro from "../assets/logo-light.png";

/** Presentación breve al abrir la app (después de que el backend ya está listo, antes de
 *  Login) — logo grande y legible sobre el navy de marca, con "Bienvenidos" debajo. Fondo fijo
 *  (no sigue el modo oscuro/claro elegido): es un momento de marca, no una pantalla de trabajo,
 *  mismo criterio que la tarjeta de login de crm-web. Se oculta sola a los pocos segundos (ver
 *  App.tsx, mostrarBienvenida). */
export function PantallaBienvenida() {
  return (
    <div
      style={{
        height: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        background: "var(--h421-navy)", gap: 32,
      }}
    >
      <img
        src={logoClaro}
        alt="HANGAR 421"
        className="h421-bienvenida-logo"
        style={{ width: "56vw", maxWidth: 680, height: "auto" }}
      />
      <p className="h421-bienvenida-texto" style={{ color: "#fff", fontSize: "clamp(22px, 3.2vw, 40px)", fontWeight: 600, letterSpacing: 1, margin: 0 }}>
        Bienvenidos
      </p>
    </div>
  );
}
