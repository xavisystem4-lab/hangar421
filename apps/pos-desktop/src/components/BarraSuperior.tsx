import { useEffect, useState } from "react";
import { useAuthStore } from "../store/authStore";
import { useSyncStore } from "../store/syncStore";

const ETIQUETAS_SYNC: Record<string, { texto: string; color: string }> = {
  SYNCED: { texto: "Sincronizado", color: "var(--h421-green)" },
  SYNCING: { texto: "Sincronizando…", color: "var(--h421-blue)" },
  PENDING: { texto: "Pendiente", color: "var(--h421-yellow)" },
  ERROR: { texto: "Error de sync", color: "var(--h421-red)" },
  OFFLINE: { texto: "Sin conexión", color: "var(--h421-gray-400)" },
};

export function BarraSuperior({ sucursalNombre, onCambiarPantalla }: { sucursalNombre: string; onCambiarPantalla: (p: "venta" | "mesas" | "caja") => void }) {
  const { usuario } = useAuthStore();
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
        <strong style={{ color: "var(--h421-amber)", fontSize: 20, letterSpacing: 1 }}>HANGAR 421</strong>
        <span style={{ opacity: 0.6 }}>|</span>
        <span>{sucursalNombre}</span>
        <span style={{ opacity: 0.6 }}>|</span>
        <span>{usuario?.nombre}</span>
      </div>

      <nav style={{ display: "flex", gap: 8 }}>
        <button onClick={() => onCambiarPantalla("venta")} style={{ background: "transparent", color: "#fff", padding: "8px 14px" }}>Venta</button>
        <button onClick={() => onCambiarPantalla("mesas")} style={{ background: "transparent", color: "#fff", padding: "8px 14px" }}>Mesas</button>
        <button onClick={() => onCambiarPantalla("caja")} style={{ background: "transparent", color: "#fff", padding: "8px 14px" }}>Caja</button>
      </nav>

      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <span>{ahora.toLocaleDateString("es-MX")} {ahora.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <span style={{ width: 10, height: 10, borderRadius: 5, background: estadoInfo.color, display: "inline-block" }} />
          {estadoInfo.texto}{sync.pendientes > 0 ? ` (${sync.pendientes})` : ""}
        </span>
      </div>
    </header>
  );
}
