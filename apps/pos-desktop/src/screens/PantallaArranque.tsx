import { useEffect, useState } from "react";
import { useThemeStore } from "../store/themeStore";
import logoOscuro from "../assets/logo-dark.png";
import logoClaro from "../assets/logo-light.png";
import fondo from "../assets/login-fondo.jpg";
import { BarraActualizacion } from "../components/BarraActualizacion";

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
 *  un botón para reintentar en vez de quedarse cargando para siempre sin explicación.
 *
 *  También hace de "bienvenida": ya no hay una pantalla aparte con el logo y "Bienvenidos"
 *  (ver App.tsx) — esta misma, al llegar la barra a 100%, la reemplaza por el saludo
 *  "Bienvenidos" un instante y se desvanece (prop `saliendo`) hacia el login/app real que se
 *  monta detrás, en vez de cortar en seco de una pantalla a otra. Por eso vive en un overlay de
 *  pantalla completa (`position: fixed`) en vez de ocupar el flujo normal — lo de abajo ya se
 *  está armando mientras esta se ve. */
export function PantallaArranque({
  mensaje,
  error,
  onReintentar,
  saliendo,
}: {
  mensaje: string;
  error?: string | null;
  onReintentar?: () => void;
  saliendo?: boolean;
}) {
  const tema = useThemeStore((s) => s.tema);
  const progreso = usarProgreso(mensaje);
  // Mismo velo que la pantalla de Login sobre la misma foto de fondo — ambas pantallas deben
  // sentirse como parte de la misma app, no una genérica y otra con identidad.
  const velo = tema === "oscuro" ? "rgba(11,30,51,0.65)" : "rgba(255,255,255,0.45)";
  // Mismo criterio que la selección de logo (logoClaro/logoOscuro arriba): el texto necesita
  // contraste contra la foto de fondo velada, que cambia de tono con el tema.
  const colorBienvenida = tema === "oscuro" ? "#fff" : "var(--h421-navy)";

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        height: "100vh", display: "flex", flexDirection: "column",
        opacity: saliendo ? 0 : 1,
        transition: "opacity 450ms ease",
        pointerEvents: saliendo ? "none" : "auto",
      }}
    >
      <div
        style={{
          flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          background: `linear-gradient(${velo}, ${velo}), url(${fondo}) center/cover no-repeat`,
          gap: 24, padding: 24, overflow: "hidden",
        }}
      >
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

          {!error && progreso < 100 && (
            <div style={{ width: 260, height: 8, borderRadius: 4, background: "var(--h421-gray-200)", overflow: "hidden" }}>
              <div style={{ width: `${progreso}%`, height: "100%", background: "var(--h421-blue)", transition: "width 0.3s ease-out" }} />
            </div>
          )}

          {!error && progreso >= 100 && (
            <p
              className="h421-bienvenida-texto"
              style={{ color: colorBienvenida, fontSize: "clamp(20px, 2.6vw, 32px)", fontWeight: 600, letterSpacing: 1, margin: 0 }}
            >
              Bienvenidos
            </p>
          )}

          {error && (
            <div style={{ maxWidth: 520, textAlign: "center" }}>
              <p style={{ color: "var(--h421-red-texto)", fontSize: 14, lineHeight: 1.5 }}>⚠ {error}</p>
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
      <BarraActualizacion />
    </div>
  );
}
