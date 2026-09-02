import { useCallback, useEffect, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { EstadoPedido, WS_EVENTS, type Pedido } from "@hangar421/shared";
import { apiFetch } from "../api/http";
import { conectarSocket } from "../api/socket";
import { useAuthStore } from "../store/authStore";
import { colores } from "../theme";

const ETIQUETA: Record<EstadoPedido, { texto: string; color: string }> = {
  [EstadoPedido.ABIERTO]: { texto: "Abierto", color: colores.gray400 },
  [EstadoPedido.ENVIADO]: { texto: "Enviado", color: colores.blue },
  [EstadoPedido.EN_PREPARACION]: { texto: "En preparación", color: colores.yellow },
  [EstadoPedido.LISTO]: { texto: "Listo — entregar", color: colores.green },
  [EstadoPedido.ENTREGADO]: { texto: "Entregado", color: colores.gray400 },
  [EstadoPedido.POR_COBRAR]: { texto: "Por cobrar", color: colores.yellow },
  [EstadoPedido.COBRADO]: { texto: "Cobrado", color: colores.green },
  [EstadoPedido.CANCELADO]: { texto: "Cancelado", color: colores.red },
};

export function MisPedidosScreen() {
  const { usuario, sucursalId } = useAuthStore();
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [refrescando, setRefrescando] = useState(false);
  const [notificacion, setNotificacion] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!sucursalId) return;
    try {
      const data = await apiFetch<Pedido[]>(`/pedidos?sucursalId=${sucursalId}`);
      setPedidos(data.filter((p) => p.meseroId === usuario?.id && p.estado !== EstadoPedido.CANCELADO));
    } catch {
      // sin conexión: se mantiene la última lista conocida
    }
  }, [sucursalId, usuario]);

  useEffect(() => {
    cargar();
    if (!sucursalId || !usuario) return;
    const socket = conectarSocket(sucursalId, usuario.id);
    socket.on(WS_EVENTS.COMANDA_LISTA, (pedido: Pedido) => {
      if (pedido.meseroId === usuario.id) {
        setNotificacion(`🔔 Pedido ${pedido.folio} listo para entregar`);
        setTimeout(() => setNotificacion(null), 6000);
      }
      cargar();
    });
    socket.on(WS_EVENTS.PEDIDO_ACTUALIZADO, cargar);
    const t = setInterval(cargar, 20_000);
    return () => { clearInterval(t); socket.disconnect(); };
  }, [sucursalId, usuario, cargar]);

  return (
    <View style={{ flex: 1 }}>
      {notificacion && (
        <View style={estilos.banner}><Text style={estilos.bannerTexto}>{notificacion}</Text></View>
      )}
      <FlatList
        data={pedidos}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: 12 }}
        refreshControl={<RefreshControl refreshing={refrescando} onRefresh={async () => { setRefrescando(true); await cargar(); setRefrescando(false); }} />}
        renderItem={({ item }) => {
          const info = ETIQUETA[item.estado];
          const minutos = Math.floor((Date.now() - new Date(item.createdAt).getTime()) / 60000);
          return (
            <View style={estilos.tarjeta}>
              <Text style={estilos.folio}>Folio {item.folio}</Text>
              <Text style={[estilos.estado, { color: info.color }]}>{info.texto} — {minutos}m</Text>
              <Text style={estilos.total}>${Number(item.total).toFixed(2)}</Text>
            </View>
          );
        }}
        ListEmptyComponent={<Text style={{ textAlign: "center", color: colores.gray400, marginTop: 40 }}>No tienes pedidos activos</Text>}
      />
    </View>
  );
}

const estilos = StyleSheet.create({
  banner: { backgroundColor: colores.green, padding: 12 },
  bannerTexto: { color: "#fff", fontWeight: "700", textAlign: "center" },
  tarjeta: { backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: colores.gray200 },
  folio: { fontWeight: "700", fontSize: 15 },
  estado: { fontWeight: "700", marginTop: 4 },
  total: { marginTop: 4, color: colores.navy, fontWeight: "700" },
});
