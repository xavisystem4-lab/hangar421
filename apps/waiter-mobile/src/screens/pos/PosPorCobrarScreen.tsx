import { useEffect, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { EstadoPedido, type Pedido } from "@hangar421/shared";
import { apiFetch } from "../../api/http";
import { useAuthStore } from "../../store/authStore";
import { usePosOrderStore } from "../../store/posOrderStore";
import { usarColores } from "../../store/temaStore";
import { PosModalCancelarPedido } from "./PosModalCancelarPedido";

// Mismos 4 estados que apps/pos-desktop/src/screens/PedidosPorCobrar.tsx — a diferencia de
// MisPedidosScreen.tsx (Comandero), aquí NO se filtra por meseroId: cualquier cajero debe poder
// cobrar cualquier cuenta de la sucursal, no solo las que él mismo tomó.
const ESTADOS_PENDIENTES = [EstadoPedido.ABIERTO, EstadoPedido.ENVIADO, EstadoPedido.EN_PREPARACION, EstadoPedido.LISTO].join(",");

const ETIQUETA_ESTADO: Record<string, { texto: string; color: string }> = {
  ABIERTO: { texto: "Pendiente de enviar", color: "#9CA3AF" },
  ENVIADO: { texto: "Enviado a cocina", color: "#2563EB" },
  EN_PREPARACION: { texto: "En preparación", color: "#F5A524" },
  LISTO: { texto: "Listo", color: "#1F9D55" },
};

function minutosDesde(fecha: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(fecha).getTime()) / 60000));
}

/** Cola de pedidos ya enviados que todavía no se cobran (sobre todo los que llegan de "Comandero"
 *  en otro dispositivo) — mismo endpoint y mismo criterio que `PedidosPorCobrar.tsx` del POS
 *  Windows. Tocar una tarjeta carga el pedido en `posOrderStore` y abre la pantalla de cobro. */
export function PosPorCobrarScreen({ onCobrarPedido }: { onCobrarPedido: (pedido: Pedido) => void }) {
  const { sucursalId } = useAuthStore();
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const [pedidos, setPedidos] = useState<Pedido[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refrescando, setRefrescando] = useState(false);
  const [pedidoACancelar, setPedidoACancelar] = useState<Pedido | null>(null);

  async function cargar() {
    if (!sucursalId) return;
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
    usePosOrderStore.getState().cargarPedidoExistente(pedido);
    onCobrarPedido(pedido);
  }

  return (
    <View style={{ flex: 1, backgroundColor: colores.fondo }}>
      <View style={{ padding: 16, paddingBottom: 0 }}>
        <Text style={estilos.titulo}>Pedidos por cobrar</Text>
        <Text style={estilos.ayuda}>Pedidos ya enviados que todavía no se cobran. Toca uno para abrir el cobro.</Text>
        {error && <Text style={estilos.error}>{error}</Text>}
      </View>

      <FlatList
        data={pedidos ?? []}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: 16 }}
        refreshControl={<RefreshControl refreshing={refrescando} onRefresh={async () => { setRefrescando(true); await cargar(); setRefrescando(false); }} />}
        ListEmptyComponent={
          pedidos !== null ? <Text style={estilos.ayuda}>No hay pedidos pendientes de cobro.</Text> : <Text style={estilos.ayuda}>Cargando…</Text>
        }
        renderItem={({ item }) => {
          const est = ETIQUETA_ESTADO[item.estado] ?? { texto: item.estado, color: colores.textoSecundario };
          return (
            <TouchableOpacity onPress={() => abrirCobro(item)} style={[estilos.tarjeta, { borderColor: est.color }]}>
              <View style={estilos.filaEncabezado}>
                <Text style={estilos.mesaNombre}>{item.mesa?.nombre ?? "Mostrador"}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={{ fontSize: 11, fontWeight: "700", color: est.color }}>{est.texto}</Text>
                  <TouchableOpacity onPress={() => setPedidoACancelar(item)} style={estilos.botonCancelar}>
                    <Text style={{ color: colores.red, fontSize: 11 }}>✕ Cancelar</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <Text style={estilos.folio}>Folio {item.folio}</Text>
              {item.mesero?.nombre && <Text style={estilos.detalle}>🧑‍🍳 Mesero: {item.mesero.nombre}</Text>}
              <View style={estilos.filaEncabezado}>
                <Text style={estilos.minutos}>Hace {minutosDesde(item.createdAt)} min</Text>
                <Text style={estilos.total}>${Number(item.total).toFixed(2)}</Text>
              </View>
            </TouchableOpacity>
          );
        }}
      />

      {pedidoACancelar && sucursalId && (
        <PosModalCancelarPedido
          pedidoId={pedidoACancelar.id}
          sucursalId={sucursalId}
          etiqueta={`${pedidoACancelar.mesa?.nombre ?? "Mostrador"} · Folio ${pedidoACancelar.folio} · $${Number(pedidoACancelar.total).toFixed(2)}`}
          onCerrar={() => setPedidoACancelar(null)}
          onCancelado={() => { setPedidoACancelar(null); cargar(); }}
        />
      )}
    </View>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    titulo: { fontSize: 20, fontWeight: "800", color: colores.texto },
    ayuda: { color: colores.textoSecundario, fontSize: 13, marginTop: 4, marginBottom: 8 },
    error: { color: colores.red, marginBottom: 8 },
    tarjeta: { backgroundColor: colores.superficie, borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 2 },
    filaEncabezado: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    mesaNombre: { fontSize: 16, fontWeight: "800", color: colores.texto },
    botonCancelar: { backgroundColor: colores.red + "22", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
    folio: { fontSize: 13, color: colores.textoSecundario, marginTop: 2 },
    detalle: { fontSize: 13, color: colores.texto, marginTop: 2 },
    minutos: { fontSize: 12, color: colores.textoSecundario, marginTop: 8 },
    total: { fontSize: 18, fontWeight: "800", color: colores.navyTexto, marginTop: 6 },
  });
}
