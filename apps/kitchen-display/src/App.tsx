import { useEffect, useMemo, useState } from "react";
import { EstadoPedidoItem, WS_EVENTS } from "@hangar421/shared";
import { apiFetch, cerrarSesion, guardarSesion } from "./api/http";
import { conectarSocket } from "./api/socket";
import { ComandaCard, type ComandaItem } from "./components/ComandaCard";
import logo from "./assets/logo-light.png";
import "./theme.css";

const COLUMNAS: { estado: EstadoPedidoItem; titulo: string }[] = [
  { estado: EstadoPedidoItem.NUEVO, titulo: "Nueva" },
  { estado: EstadoPedidoItem.EN_PREPARACION, titulo: "En preparación" },
  { estado: EstadoPedidoItem.LISTO, titulo: "Lista" },
  { estado: EstadoPedidoItem.ENTREGADO, titulo: "Entregada" },
  { estado: EstadoPedidoItem.CANCELADO, titulo: "Cancelada" },
];

interface Sesion {
  sucursalId: string;
  estacionCocinaId?: string;
  dispositivoId: string;
}

function cargarSesion(): Sesion | null {
  const raw = localStorage.getItem("hangar421_kds_sesion");
  return raw ? JSON.parse(raw) : null;
}

export default function App() {
  const [sesion, setSesion] = useState<Sesion | null>(cargarSesion());
  const [items, setItems] = useState<ComandaItem[]>([]);
  const [alertasOn, setAlertasOn] = useState(true);
  const audioNueva = useMemo(() => new Audio("data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA="), []);

  useEffect(() => {
    if (!sesion) return;
    cargarComandas(sesion.sucursalId);
    const socket = conectarSocket(sesion.sucursalId, sesion.estacionCocinaId);

    socket.on(WS_EVENTS.COMANDA_NUEVA, () => {
      cargarComandas(sesion.sucursalId);
      if (alertasOn) audioNueva.play().catch(() => undefined);
    });
    socket.on(WS_EVENTS.PEDIDO_ITEM_ACTUALIZADO, () => cargarComandas(sesion.sucursalId));
    socket.on(WS_EVENTS.PEDIDO_ACTUALIZADO, () => cargarComandas(sesion.sucursalId));

    const poll = setInterval(() => cargarComandas(sesion.sucursalId), 30_000);
    return () => {
      clearInterval(poll);
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sesion]);

  async function cargarComandas(sucursalId: string) {
    try {
      const data = await apiFetch<ComandaItem[]>(
        `/cocina/comandas?sucursalId=${sucursalId}`,
      );
      setItems(data);
    } catch (e) {
      console.error("Error cargando comandas", e);
    }
  }

  async function cambiarEstado(item: ComandaItem, estado: EstadoPedidoItem) {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, estado } : i)));
    try {
      await apiFetch(`/pedidos/${item.pedidoId}/items/${item.id}/estado`, {
        method: "PATCH",
        body: JSON.stringify({ estado }),
      });
    } catch (e) {
      console.error(e);
      cargarComandas(sesion!.sucursalId);
    }
  }

  if (!sesion) {
    return <Configuracion onListo={(s) => { localStorage.setItem("hangar421_kds_sesion", JSON.stringify(s)); setSesion(s); }} />;
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <header style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "16px 24px", background: "var(--h421-navy)", borderBottom: "2px solid var(--h421-amber)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img src={logo} alt="HANGAR 421" style={{ height: 28, width: "auto" }} />
          <span style={{ color: "var(--h421-gray-400)" }}>Cocina</span>
        </div>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <button
            onClick={() => setAlertasOn((v) => !v)}
            style={{ background: alertasOn ? "var(--h421-green)" : "var(--h421-gray-400)", color: "#fff", padding: "10px 16px" }}
          >
            {alertasOn ? "🔊 Alertas ON" : "🔇 Alertas OFF"}
          </button>
          <button
            onClick={() => { cerrarSesion(); localStorage.removeItem("hangar421_kds_sesion"); setSesion(null); }}
            style={{ background: "var(--h421-red)", color: "#fff", padding: "10px 16px" }}
          >
            Salir
          </button>
        </div>
      </header>

      <main style={{ flex: 1, display: "grid", gridTemplateColumns: `repeat(${COLUMNAS.length}, 1fr)`, gap: 12, padding: 16, overflowX: "auto" }}>
        {COLUMNAS.map((col) => {
          const itemsCol = items.filter((i) => i.estado === col.estado);
          return (
            <section key={col.estado} style={{ background: "var(--h421-gray-50)", borderRadius: 16, padding: 12, color: "var(--h421-black)", minWidth: 260 }}>
              <h2 style={{ fontSize: 16, margin: "4px 8px 12px" }}>
                {col.titulo} <span style={{ color: "var(--h421-gray-400)" }}>({itemsCol.length})</span>
              </h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {itemsCol.map((item) => (
                  <ComandaCard key={item.id} item={item} onCambiarEstado={cambiarEstado} />
                ))}
              </div>
            </section>
          );
        })}
      </main>
    </div>
  );
}

function Configuracion({ onListo }: { onListo: (s: Sesion) => void }) {
  const [sucursalId, setSucursalId] = useState("");
  const [usuarioId, setUsuarioId] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function conectar() {
    setError(null);
    const dispositivoId = localStorage.getItem("hangar421_kds_device") ?? crypto.randomUUID();
    localStorage.setItem("hangar421_kds_device", dispositivoId);
    try {
      const resp = await apiFetch<{ accessToken: string }>("/auth/login-pin", {
        method: "POST",
        body: JSON.stringify({ usuarioId, pin, sucursalId, dispositivoId }),
      });
      guardarSesion(resp.accessToken);
      onListo({ sucursalId, dispositivoId });
    } catch (e: any) {
      setError(e.message ?? "No se pudo conectar");
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "var(--h421-navy)", padding: 32, borderRadius: 16, width: 360 }}>
        <h1 style={{ color: "var(--h421-amber)", fontSize: 20 }}>HANGAR 421 — Configurar pantalla de cocina</h1>
        <p style={{ color: "var(--h421-gray-400)", fontSize: 13 }}>
          Usa las credenciales de un usuario con rol Cocina (ver datos demo del seed).
        </p>
        <Campo label="ID de sucursal" value={sucursalId} onChange={setSucursalId} />
        <Campo label="ID de usuario (cocina)" value={usuarioId} onChange={setUsuarioId} />
        <Campo label="PIN" value={pin} onChange={setPin} type="password" />
        {error && <p style={{ color: "var(--h421-red)" }}>{error}</p>}
        <button onClick={conectar} style={{ width: "100%", padding: 14, background: "var(--h421-green)", color: "#fff", marginTop: 12, fontSize: 16 }}>
          Conectar
        </button>
      </div>
    </div>
  );
}

function Campo({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label style={{ display: "block", marginTop: 12, color: "#fff", fontSize: 13 }}>
      {label}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ display: "block", width: "100%", padding: 10, marginTop: 4, borderRadius: 8, border: "none" }}
      />
    </label>
  );
}
