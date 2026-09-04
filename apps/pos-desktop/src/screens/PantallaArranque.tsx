import logo from "../assets/logo-dark.png";

/** Se muestra mientras Electron levanta el backend embebido (Postgres + API local) — solo
 *  toma unos segundos, y solo la primera vez que se abre la app crea la base de datos.
 *  Si algo falla (por ejemplo, el antivirus bloqueando un binario), muestra el error con
 *  un botón para reintentar en vez de quedarse cargando para siempre sin explicación. */
export function PantallaArranque({
  mensaje,
  error,
  onReintentar,
}: {
  mensaje: string;
  error?: string | null;
  onReintentar?: () => void;
}) {
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "var(--h421-gray-50)", gap: 24, padding: 24 }}>
      <img src={logo} alt="HANGAR 421" style={{ width: "50vw", maxWidth: 640, height: "auto" }} />

      {!error && (
        <>
          <div style={{ width: 220, height: 6, borderRadius: 3, background: "var(--h421-gray-200)", overflow: "hidden" }}>
            <div style={{ width: "40%", height: "100%", background: "var(--h421-amber)", animation: "arranque-barra 1.2s ease-in-out infinite" }} />
          </div>
          <p style={{ color: "var(--h421-gray-400)", fontSize: 14 }}>{mensaje}</p>
        </>
      )}

      {error && (
        <div style={{ maxWidth: 520, textAlign: "center" }}>
          <p style={{ color: "var(--h421-red)", fontSize: 14, lineHeight: 1.5 }}>⚠ {error}</p>
          <p style={{ color: "var(--h421-gray-400)", fontSize: 12, marginTop: 8 }}>
            Detalle completo en <code>%APPDATA%\HANGAR 421 POS\local-data\arranque.log</code>
          </p>
          <button
            onClick={onReintentar}
            className="btn-grande"
            style={{ marginTop: 16, background: "var(--h421-navy)", color: "#fff", padding: "0 28px" }}
          >
            ⟳ Reintentar
          </button>
        </div>
      )}

      <style>{`
        @keyframes arranque-barra {
          0% { transform: translateX(-120%); }
          100% { transform: translateX(370%); }
        }
      `}</style>
    </div>
  );
}
