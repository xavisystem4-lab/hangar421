import { useEffect, useState } from "react";
import { useThemeStore } from "../store/themeStore";
import logoOscuro from "../assets/logo-dark.png";
import logoClaro from "../assets/logo-light.png";

/** Hitos del arranque del backend embebido, en el orden real en que los emite
 *  `iniciarBackendEmbebido` (electron/backend-manager.ts vía "backend:onEstado") — mapean el
 *  mensaje de texto a un % de avance real, en vez de una animación indeterminada. El primer
 *  hito ("=== Arrancando…") SIEMPRE resetea la barra a su valor (no solo al máximo alcanzado):
 *  es lo que se loguea de nuevo al reintentar tras un error, y sin este caso especial la barra
 *  se quedaría pegada en el % donde falló el intento anterior. Los mensajes intermedios
 *  ruidosos ([postgres]/[backend], salida cruda de los procesos) no están en esta lista y por
 *  lo tanto no mueven la barra — solo estos hitos "importantes" lo hacen. */
const HITOS: { prefijo: string; progreso: number }[] = [
  { prefijo: "=== Arrancando backend embebido", progreso: 4 },
  { prefijo: "Verificación de archivos", progreso: 10 },
  { prefijo: "Primera vez", progreso: 18 },
  { prefijo: "Base de datos local existente", progreso: 18 },
  { prefijo: "Inicializando PostgreSQL", progreso: 25 },
  { prefijo: "Arrancando PostgreSQL", progreso: 45 },
  { prefijo: "Creando base de datos hangar421", progreso: 62 },
  { prefijo: "Iniciando backend local", progreso: 72 },
  { prefijo: "Backend local listo en", progreso: 100 },
];

function usarProgreso(mensaje: string): number {
  const [progreso, setProgreso] = useState(0);
  useEffect(() => {
    const hito = HITOS.find((h) => mensaje.startsWith(h.prefijo));
    if (!hito) return;
    setProgreso((previo) => (hito === HITOS[0] ? hito.progreso : Math.max(previo, hito.progreso)));
  }, [mensaje]);
  return progreso;
}

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
  const tema = useThemeStore((s) => s.tema);
  const progreso = usarProgreso(mensaje);

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "var(--h421-gray-50)", gap: 24, padding: 24 }}>
      <div style={{ position: "relative", width: "50vw", maxWidth: 640 }}>
        <img src={tema === "oscuro" ? logoClaro : logoOscuro} alt="HANGAR 421" style={{ width: "100%", height: "auto", display: "block" }} />
        {/* "POS" sobre el "421" del logo — distingue esta pantalla de la app de Meseros, que
            usa el mismo wordmark "HANGAR 421" sin esta etiqueta. */}
        <span
          style={{
            position: "absolute", top: "10%", right: "5%", fontSize: "3.2vw", fontWeight: 800,
            letterSpacing: 2, color: "var(--h421-navy)", textTransform: "uppercase",
          }}
        >
          POS
        </span>
      </div>

      {!error && (
        <>
          <div style={{ width: 260, height: 8, borderRadius: 4, background: "var(--h421-gray-200)", overflow: "hidden" }}>
            <div style={{ width: `${progreso}%`, height: "100%", background: "var(--h421-blue)", transition: "width 0.3s ease-out" }} />
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
    </div>
  );
}
