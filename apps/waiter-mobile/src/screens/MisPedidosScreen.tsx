import { useCallback, useEffect, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { EstadoPedido, WS_EVENTS, type Pedido } from "@hangar421/shared";
import { apiFetch } from "../api/http";
import { obtenerSocket } from "../api/socket";
import { useAuthStore } from "../store/authStore";
import { usarColores } from "../store/temaStore";

export function MisPedidosScreen() {
  const { usuario, sucursalId } = useAuthStore();
  const colores = usarColores();
  const estilos = crearEstilos(colores);
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
    // El socket ya está conectado a nivel de App.tsx (toda la sesión) — esta pantalla solo se
    // suma a escuchar, no es dueña del ciclo de vida de la conexión (no lo desconecta al salir).
    const socket = obtenerSocket();
    const manejarComandaLista = (pedido: Pedido) => {
      if (pedido.meseroId === usuario.id) {
        setNotificacion(`🔔 Pedido ${pedido.folio} listo para entregar`);
        setTimeout(() => setNotificacion(null), 6000);
      }
      cargar();
    };
    socket?.on(WS_EVENTS.COMANDA_LISTA, manejarComandaLista);
    socket?.on(WS_EVENTS.PEDIDO_ACTUALIZADO, cargar);
    const t = setInterval(cargar, 20_000);
    return () => {
      clearInterval(t);
      socket?.off(WS_EVENTS.COMANDA_LISTA, manejarComandaLista);
      socket?.off(WS_EVENTS.PEDIDO_ACTUALIZADO, cargar);
    };
  }, [sucursalId, usuario, cargar]);

  return (
    <View style={{ flex: 1, backgroundColor: colores.fondo }}>
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
        ListEmptyComponent={<Text style={{ textAlign: "center", color: colores.textoSecundario, marginTop: 40 }}>No tienes pedidos activos</Text>}
      />
    </View>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    banner: { backgroundColor: colores.green, padding: 12 },
    bannerTexto: { color: "#fff", fontWeight: "700", textAlign: "center" },
    tarjeta: { backgroundColor: colores.superficie, borderRadius: 12, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: colores.borde },
    folio: { fontWeight: "700", fontSize: 15, color: colores.texto },
    estado: { fontWeight: "700", marginTop: 4 },
    total: { marginTop: 4, color: colores.navyTexto, fontWeight: "700" },
  });
}
