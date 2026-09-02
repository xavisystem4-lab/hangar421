import { useEffect, useState } from "react";
import { EstadoPedidoItem } from "@hangar421/shared";

export interface ComandaItem {
  id: string;
  pedidoId: string;
  cantidad: number;
  notas: string | null;
  estado: EstadoPedidoItem;
  createdAt: string;
  producto: { nombre: string };
  modificadores: { opcionModificador: { nombre: string } }[];
  pedido: { folio: string; mesa: { nombre: string } | null; notasGenerales: string | null };
}

const SIGUIENTE: Partial<Record<EstadoPedidoItem, { estado: EstadoPedidoItem; etiqueta: string; color: string }>> = {
  [EstadoPedidoItem.NUEVO]: { estado: EstadoPedidoItem.EN_PREPARACION, etiqueta: "▶ Empezar", color: "var(--h421-blue)" },
  [EstadoPedidoItem.EN_PREPARACION]: { estado: EstadoPedidoItem.LISTO, etiqueta: "✔ Marcar listo", color: "var(--h421-green)" },
  [EstadoPedidoItem.LISTO]: { estado: EstadoPedidoItem.ENTREGADO, etiqueta: "📦 Entregado", color: "var(--h421-navy)" },
};

export function ComandaCard({ item, onCambiarEstado }: { item: ComandaItem; onCambiarEstado: (item: ComandaItem, estado: EstadoPedidoItem) => void }) {
  const [minutos, setMinutos] = useState(0);

  useEffect(() => {
    const tick = () => setMinutos(Math.floor((Date.now() - new Date(item.createdAt).getTime()) / 60_000));
    tick();
    const t = setInterval(tick, 15_000);
    return () => clearInterval(t);
  }, [item.createdAt]);

  const borde = minutos < 5 ? "var(--h421-green)" : minutos < 10 ? "var(--h421-yellow)" : "var(--h421-red)";
  const accion = SIGUIENTE[item.estado];
  const tieneNota = item.notas || item.pedido.notasGenerales;

  return (
    <article style={{ background: "#fff", borderRadius: 12, borderLeft: `6px solid ${borde}`, boxShadow: "0 1px 4px rgba(0,0,0,0.15)", padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#555" }}>
        <strong>{item.pedido.mesa ? item.pedido.mesa.nombre : `Folio ${item.pedido.folio}`}</strong>
        <span>{minutos}m</span>
      </div>
      <div style={{ fontSize: 16, fontWeight: 600, marginTop: 6 }}>
        {item.cantidad}x {item.producto.nombre}
      </div>
      {item.modificadores.length > 0 && (
        <div style={{ fontSize: 13, color: "#666" }}>
          {item.modificadores.map((m) => m.opcionModificador.nombre).join(", ")}
        </div>
      )}
      {tieneNota && (
        <div style={{ background: "#fee2e2", color: "#991b1b", padding: 6, borderRadius: 8, fontSize: 13, marginTop: 6, fontWeight: 600 }}>
          ⚠ {item.notas} {item.pedido.notasGenerales}
        </div>
      )}
      {accion && (
        <button
          onClick={() => onCambiarEstado(item, accion.estado)}
          style={{ width: "100%", marginTop: 10, padding: 14, fontSize: 15, color: "#fff", background: accion.color }}
        >
          {accion.etiqueta}
        </button>
      )}
    </article>
  );
}
