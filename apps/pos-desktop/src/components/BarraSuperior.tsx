import { useEffect, useState } from "react";
import { useAuthStore } from "../store/authStore";
import { useSyncStore } from "../store/syncStore";
import logo from "../assets/logo-light.png";

const ETIQUETAS_SYNC: Record<string, { texto: string; color: string }> = {
  SYNCED: { texto: "Sincronizado", color: "var(--h421-green)" },
  SYNCING: { texto: "Sincronizando…", color: "var(--h421-blue)" },
  PENDING: { texto: "Pendiente", color: "var(--h421-yellow)" },
  ERROR: { texto: "Error de sync", color: "var(--h421-red)" },
  OFFLINE: { texto: "Sin conexión", color: "var(--h421-gray-400)" },
};

const OPCIONES_NAV: { id: "venta" | "mesas" | "caja"; etiqueta: string }[] = [
  { id: "venta", etiqueta: "Venta" },
  { id: "mesas", etiqueta: "Mesas" },
  { id: "caja", etiqueta: "Caja" },
];

export function BarraSuperior({
  sucursalNombre,
  pantallaActual,
  onCambiarPantalla,
}: {
  sucursalNombre: string;
  pantallaActual: "venta" | "mesas" | "caja";
  onCambiarPantalla: (p: "venta" | "mesas" | "caja") => void;
}) {
  const { usuario, logout } = useAuthStore();
  const sync = useSyncStore();
  const [ahora, setAhora] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setAhora(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const estadoInfo = ETIQUETAS_SYNC[sync.estado];

  return (
    <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 20px", background: "var(--h421-navy)", color: "#fff" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <img src={logo} alt="HANGAR 421" style={{ height: 26, width: "auto" }} />
        <span style={{ opacity: 0.6 }}>|</span>
        <span>{sucursalNombre}</span>
        <span style={{ opacity: 0.6 }}>|</span>
        <span>{usuario?.nombre}</span>
      </div>

      <nav style={{ display: "flex", gap: 8 }}>
        {OPCIONES_NAV.map((opcion) => {
          const activa = pantallaActual === opcion.id;
          return (
            <button
              key={opcion.id}
              onClick={() => onCambiarPantalla(opcion.id)}
              style={{
                background: activa ? "var(--h421-amber)" : "rgba(255,255,255,0.12)",
                color: activa ? "var(--h421-navy)" : "#fff",
                fontWeight: activa ? 700 : 500,
                border: "none",
                borderRadius: 8,
                padding: "9px 18px",
                fontSize: 14,
                cursor: "pointer",
                transition: "background 0.15s, color 0.15s",
              }}
            >
              {opcion.etiqueta}
            </button>
          );
        })}
      </nav>

      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <span>{ahora.toLocaleDateString("es-MX")} {ahora.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <span style={{ width: 10, height: 10, borderRadius: 5, background: estadoInfo.color, display: "inline-block" }} />
          {estadoInfo.texto}{sync.pendientes > 0 ? ` (${sync.pendientes})` : ""}
        </span>
        <span style={{ opacity: 0.6 }}>|</span>
        <button
          onClick={() => logout()}
          title="Vuelve a la pantalla de inicio para que otro usuario entre con su contraseña"
          style={{ background: "rgba(255,255,255,0.12)", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600 }}
        >
          ⇄ Cambiar de usuario
        </button>
        <button
          onClick={() => logout()}
          style={{ background: "var(--h421-red)", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600 }}
        >
          ⏻ Cerrar sesión
        </button>
      </div>
    </header>
  );
}
