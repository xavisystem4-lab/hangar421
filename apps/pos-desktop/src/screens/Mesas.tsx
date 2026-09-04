import { useEffect, useState } from "react";
import { EstadoMesa } from "@hangar421/shared";
import { useCatalogoStore } from "../store/catalogStore";
import { useOrderStore } from "../store/orderStore";

const COLOR: Record<EstadoMesa, string> = {
  [EstadoMesa.LIBRE]: "var(--h421-gray-400)",
  [EstadoMesa.OCUPADA]: "var(--h421-blue)",
  [EstadoMesa.RESERVADA]: "#8b5cf6",
  [EstadoMesa.POR_COBRAR]: "var(--h421-yellow)",
  [EstadoMesa.PEDIDO_LISTO]: "var(--h421-green)",
};
const ETIQUETA: Record<EstadoMesa, string> = {
  [EstadoMesa.LIBRE]: "Libre",
  [EstadoMesa.OCUPADA]: "Ocupada",
  [EstadoMesa.RESERVADA]: "Reservada",
  [EstadoMesa.POR_COBRAR]: "Por cobrar",
  [EstadoMesa.PEDIDO_LISTO]: "Pedido listo",
};

export function Mesas({ sucursalId, onAbrirMesa }: { sucursalId: string; onAbrirMesa: (mesaId: string, nombre: string) => void }) {
  const { mesas, refrescarMesas } = useCatalogoStore();
  const [comensales, setComensales] = useState(2);

  useEffect(() => {
    refrescarMesas(sucursalId);
    const t = setInterval(() => refrescarMesas(sucursalId), 15_000);
    return () => clearInterval(t);
  }, [sucursalId]);

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Mesas — Salón principal</h2>
        <label style={{ fontSize: 14 }}>
          Comensales por defecto:{" "}
          <input type="number" min={1} value={comensales} onChange={(e) => setComensales(Number(e.target.value))} style={{ width: 60, padding: 6 }} />
        </label>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 16 }}>
        {mesas.map((mesa) => (
          <button
            key={mesa.id}
            onClick={() => { useOrderStore.getState().iniciar(mesa.id, comensales); onAbrirMesa(mesa.id, mesa.nombre); }}
            className="btn-grande"
            style={{ background: "var(--h421-white)", border: `3px solid ${COLOR[mesa.estado]}`, padding: 16, display: "flex", flexDirection: "column", gap: 6 }}
          >
            <strong style={{ fontSize: 18 }}>{mesa.nombre}</strong>
            <span style={{ fontSize: 12, color: COLOR[mesa.estado], fontWeight: 700 }}>{ETIQUETA[mesa.estado]}</span>
            <span style={{ fontSize: 12, color: "var(--h421-gray-400)" }}>{mesa.capacidad} personas</span>
          </button>
        ))}
      </div>
    </div>
  );
}
