import { useEffect, useState } from "react";
import { SafeAreaView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { Mesa } from "@hangar421/shared";
import { useAuthStore } from "./src/store/authStore";
import { useSyncStore } from "./src/store/syncStore";
import { iniciarSync, detenerSync } from "./src/sync/syncEngine";
import { LoginScreen } from "./src/screens/LoginScreen";
import { MesasScreen } from "./src/screens/MesasScreen";
import { TomaPedidoScreen } from "./src/screens/TomaPedidoScreen";
import { MisPedidosScreen } from "./src/screens/MisPedidosScreen";
import { useOrderStore } from "./src/store/orderStore";
import { colores } from "./src/theme";

type Pantalla = "mesas" | "pedido" | "mispedidos";

export default function App() {
  const auth = useAuthStore();
  const sync = useSyncStore();
  const [pantalla, setPantalla] = useState<Pantalla>("mesas");
  const [mesaActiva, setMesaActiva] = useState<Mesa | null>(null);

  useEffect(() => {
    auth.inicializar();
  }, []);

  useEffect(() => {
    if (!auth.usuario) return;
    iniciarSync();
    return () => detenerSync();
  }, [auth.usuario]);

  if (auth.cargando) return null;
  if (!auth.usuario) return <LoginScreen />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colores.gray50 }}>
      <StatusBar barStyle="light-content" backgroundColor={colores.navy} />
      <View style={estilos.header}>
        <Text style={estilos.headerTitulo}>HANGAR 421</Text>
        <Text style={estilos.headerSync}>{sync.estado === "SYNCED" ? "● Sincronizado" : sync.estado === "SYNCING" ? "● Sincronizando…" : `○ Sin conexión (${sync.pendientes})`}</Text>
      </View>

      <View style={{ flex: 1 }}>
        {pantalla === "mesas" && (
          <MesasScreen
            onAbrirMesa={(mesa) => { setMesaActiva(mesa); setPantalla("pedido"); }}
            onMostrador={() => { useOrderStore.getState().iniciar(null, 1); setMesaActiva(null); setPantalla("pedido"); }}
          />
        )}
        {pantalla === "pedido" && (
          <TomaPedidoScreen mesaNombre={mesaActiva?.nombre ?? null} onEnviado={() => setPantalla("mesas")} />
        )}
        {pantalla === "mispedidos" && <MisPedidosScreen />}
      </View>

      <View style={estilos.tabBar}>
        <TabBoton texto="Mesas" activo={pantalla === "mesas"} onPress={() => setPantalla("mesas")} />
        <TabBoton texto="Pedido" activo={pantalla === "pedido"} onPress={() => setPantalla("pedido")} />
        <TabBoton texto="Mis pedidos" activo={pantalla === "mispedidos"} onPress={() => setPantalla("mispedidos")} />
      </View>
    </SafeAreaView>
  );
}

function TabBoton({ texto, activo, onPress }: { texto: string; activo: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={[estilos.tabBoton, activo && estilos.tabBotonActivo]}>
      <Text style={[estilos.tabTexto, activo && estilos.tabTextoActivo]}>{texto}</Text>
    </TouchableOpacity>
  );
}

const estilos = StyleSheet.create({
  header: { backgroundColor: colores.navy, padding: 14, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  headerTitulo: { color: colores.amber, fontWeight: "800", fontSize: 16, letterSpacing: 1 },
  headerSync: { color: "#fff", fontSize: 12 },
  tabBar: { flexDirection: "row", borderTopWidth: 1, borderTopColor: colores.gray200, backgroundColor: "#fff" },
  tabBoton: { flex: 1, padding: 14, alignItems: "center", minHeight: 56, justifyContent: "center" },
  tabBotonActivo: { borderTopWidth: 3, borderTopColor: colores.navy },
  tabTexto: { color: colores.gray400, fontWeight: "600" },
  tabTextoActivo: { color: colores.navy },
});
