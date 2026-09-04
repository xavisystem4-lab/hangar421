import { useEffect, useState } from "react";
import { EstadoPedido, type Pedido } from "@hangar421/shared";
import { apiFetch } from "../api/http";
import { useOrderStore } from "../store/orderStore";
import { ModalCobro } from "../components/ModalCobro";

// Incluye ABIERTO como red de seguridad: el POS de escritorio nunca persiste un pedido en
// ABIERTO antes de cobrar/enviar (el carrito vive solo en memoria, ver orderStore.ts), así que
// el único origen real de un pedido ABIERTO en el backend es la app de Meseros — y ahí solo
// debería pasar si un bug futuro similar al de sync.service.ts (perder `enviarInmediato` al
// reconstruir un pedido desde la cola offline) vuelve a colarse. Sin esta entrada, ese pedido
// quedaría invisible para siempre porque ya no hay flujo de cocina que lo transicione.
const ESTADOS_PENDIENTES = [EstadoPedido.ABIERTO, EstadoPedido.ENVIADO, EstadoPedido.EN_PREPARACION, EstadoPedido.LISTO].join(",");

const ETIQUETA_ESTADO: Record<string, { texto: string; color: string }> = {
  ABIERTO: { texto: "Pendiente de enviar", color: "var(--h421-gray-400)" },
  ENVIADO: { texto: "Enviado a cocina", color: "var(--h421-blue)" },
  EN_PREPARACION: { texto: "En preparación", color: "var(--h421-yellow)" },
  LISTO: { texto: "Listo", color: "var(--h421-green)" },
};

function minutosDesde(fecha: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(fecha).getTime()) / 60000));
}

/** Cola de pedidos ya enviados que todavía no se cobran — sobre todo los que llegan de la app
 *  de Meseros: el mesero toma la orden en la mesa y la envía a cocina desde la tablet, pero
 *  hasta ahora no había ninguna pantalla en el POS que los mostrara — Mesas.tsx solo abría un
 *  carrito en blanco al tocar una mesa, sin importar si ya tenía un pedido enviado. Cada tarjeta
 *  trae lo necesario para reconocer de un vistazo de quién es: mesero, mesa (o "Mostrador" si es
 *  para llevar) y cliente si el pedido tiene uno asociado. Al tocar una se abre el mismo
 *  ModalCobro que usan los pedidos creados en el propio POS (ver orderStore.cargarPedidoExistente). */
export function PedidosPorCobrar({ sucursalId }: { sucursalId: string }) {
  const [pedidos, setPedidos] = useState<Pedido[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pedidoActivo, setPedidoActivo] = useState<Pedido | null>(null);

  async function cargar() {
    try {
      const data = await apiFetch<Pedido[]>(`/pedidos?sucursalId=${sucursalId}&estados=${ESTADOS_PENDIENTES}`);
      setPedidos(data);
      setError(null);
    } catch (e: any) {
      setError(e.message ?? "No se pudieron cargar los pedidos pendientes");
    }
  }

  useEffect(() => {
    cargar();
    const t = setInterval(cargar, 15_000);
    return () => clearInterval(t);
  }, [sucursalId]);

  function abrirCobro(pedido: Pedido) {
    useOrderStore.getState().cargarPedidoExistente(pedido);
    setPedidoActivo(pedido);
  }

  return (
    <div style={{ padding: 24, height: "100%", overflowY: "auto" }}>
      <h2 style={{ margin: "0 0 4px" }}>Pedidos por cobrar</h2>
      <p style={{ color: "var(--h421-gray-400)", margin: "0 0 20px", fontSize: 14 }}>
        Pedidos ya enviados (sobre todo desde la app de Meseros) que todavía no se cobran. Toca uno para abrir el cobro.
      </p>

      {error && <p style={{ color: "var(--h421-red)" }}>{error}</p>}
      {pedidos === null && !error && <p style={{ color: "var(--h421-gray-400)" }}>Cargando…</p>}
      {pedidos && pedidos.length === 0 && <p style={{ color: "var(--h421-gray-400)" }}>No hay pedidos pendientes de cobro.</p>}

      {pedidos && pedidos.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
          {pedidos.map((p) => {
            const est = ETIQUETA_ESTADO[p.estado] ?? { texto: p.estado, color: "var(--h421-gray-400)" };
            return (
              <button
                key={p.id}
                onClick={() => abrirCobro(p)}
                className="btn-grande"
                style={{
                  background: "var(--h421-white)", borderRadius: 14, padding: 16, textAlign: "left",
                  display: "flex", flexDirection: "column", gap: 6, border: `2px solid ${est.color}`,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong style={{ fontSize: 16 }}>{p.mesa?.nombre ?? "Mostrador"}</strong>
                  <span style={{ fontSize: 11, fontWeight: 700, color: est.color }}>{est.texto}</span>
                </div>
                <span style={{ fontSize: 13, color: "var(--h421-gray-400)" }}>Folio {p.folio}</span>
                {p.mesero?.nombre && <span style={{ fontSize: 13 }}>🧑‍🍳 Mesero: {p.mesero.nombre}</span>}
                {p.cliente?.nombre && <span style={{ fontSize: 13 }}>👤 Cliente: {p.cliente.nombre}</span>}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                  <span style={{ fontSize: 12, color: "var(--h421-gray-400)" }}>Hace {minutosDesde(p.createdAt)} min</span>
                  <span style={{ fontSize: 18, fontWeight: 800, color: "var(--h421-navy-texto)" }}>${p.total.toFixed(2)}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {pedidoActivo && (
        <ModalCobro
          mesaNombre={pedidoActivo.mesa?.nombre ?? null}
          onCerrar={() => { setPedidoActivo(null); useOrderStore.getState().limpiar(); }}
          onCobrado={() => { setPedidoActivo(null); cargar(); }}
        />
      )}
    </div>
  );
}
