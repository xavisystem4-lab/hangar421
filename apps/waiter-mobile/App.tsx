import { useEffect, useState } from "react";
import { SafeAreaView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { Mesa } from "@hangar421/shared";
import { useAuthStore } from "./src/store/authStore";
import { useSyncStore } from "./src/store/syncStore";
import { useConexionStore } from "./src/store/conexionStore";
import { useTemaStore, usarColores } from "./src/store/temaStore";
import { iniciarSync, detenerSync } from "./src/sync/syncEngine";
import { LoginScreen } from "./src/screens/LoginScreen";
import { ConexionScreen } from "./src/screens/ConexionScreen";
import { MesasScreen } from "./src/screens/MesasScreen";
import { TomaPedidoScreen } from "./src/screens/TomaPedidoScreen";
import { MisPedidosScreen } from "./src/screens/MisPedidosScreen";
import { useOrderStore } from "./src/store/orderStore";
import { BarraActualizacion } from "./src/components/BarraActualizacion";

type Pantalla = "mesas" | "pedido" | "mispedidos";

export default function App() {
  const auth = useAuthStore();
  const sync = useSyncStore();
  const conexion = useConexionStore();
  const tema = useTemaStore();
  const colores = usarColores();
  const [pantalla, setPantalla] = useState<Pantalla>("mesas");
  const [mesaActiva, setMesaActiva] = useState<Mesa | null>(null);
  const [configurandoEstacion, setConfigurandoEstacion] = useState(false);

  useEffect(() => {
    conexion.cargar();
    conexion.iniciarHeartbeat();
    return () => conexion.detenerHeartbeat();
  }, []);

  useEffect(() => {
    auth.inicializar();
  }, []);

  useEffect(() => {
    tema.cargar();
  }, []);

  useEffect(() => {
    if (!auth.usuario) return;
    iniciarSync();
    return () => detenerSync();
  }, [auth.usuario]);

  const estilos = crearEstilos(colores);

  if (auth.cargando || conexion.cargando || tema.cargando) return null;

  if (!auth.usuario) {
    // Antes de poder iniciar sesión hace falta saber a qué Estación (servidor) conectarse —
    // una vez logeado, si la conexión se cae, la app sigue funcionando en modo offline-first
    // (ver syncEngine/outbox) en vez de bloquear la pantalla.
    //
    // OJO: se compara contra "error" (no contra "!== conectado"). El heartbeat de conexionStore
    // vuelve a poner estado en "verificando" cada 15s aunque siga todo bien — si aquí se hubiera
    // seguido tratando "verificando" como desconectado, cada 15s esta pantalla habría cambiado
    // de LoginScreen a ConexionScreen y de vuelta, desmontando el formulario de login a medio
    // escribir (el mesero perdía el PIN que estaba tecleando). Con "error" el cambio de pantalla
    // solo ocurre cuando el heartbeat de verdad confirma que la Estación dejó de responder.
    if (conexion.estado === "error" || configurandoEstacion) {
      return (
        <SafeAreaView style={{ flex: 1, backgroundColor: colores.navy }}>
          <ConexionScreen
            onConectado={() => setConfigurandoEstacion(false)}
            onCancelar={configurandoEstacion && conexion.estado === "conectado" ? () => setConfigurandoEstacion(false) : undefined}
          />
        </SafeAreaView>
      );
    }
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colores.fondo }}>
        <View style={{ flex: 1 }}>
          <LoginScreen onConfigurarEstacion={() => setConfigurandoEstacion(true)} />
        </View>
        <BarraActualizacion />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colores.fondo }}>
      <StatusBar barStyle="light-content" backgroundColor={colores.navy} />
      <View style={estilos.header}>
        <Text style={estilos.headerTitulo}>HANGAR 421</Text>
        <View style={estilos.headerAcciones}>
          <Text style={estilos.headerSync}>{sync.estado === "SYNCED" ? "● Sincronizado" : sync.estado === "SYNCING" ? "● Sincronizando…" : `○ Sin conexión (${sync.pendientes})`}</Text>
          <TouchableOpacity onPress={tema.alternar} style={estilos.botonTema}>
            <Text style={estilos.botonTemaTexto}>{tema.tema === "oscuro" ? "☀️" : "🌙"}</Text>
          </TouchableOpacity>
        </View>
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
        <TabBoton texto="Mesas" activo={pantalla === "mesas"} onPress={() => setPantalla("mesas")} colores={colores} />
        <TabBoton texto="Pedido" activo={pantalla === "pedido"} onPress={() => setPantalla("pedido")} colores={colores} />
        <TabBoton texto="Mis pedidos" activo={pantalla === "mispedidos"} onPress={() => setPantalla("mispedidos")} colores={colores} />
      </View>
      <BarraActualizacion />
    </SafeAreaView>
  );
}

function TabBoton({
  texto,
  activo,
  onPress,
  colores,
}: {
  texto: string;
  activo: boolean;
  onPress: () => void;
  colores: ReturnType<typeof usarColores>;
}) {
  const estilos = crearEstilos(colores);
  return (
    <TouchableOpacity onPress={onPress} style={[estilos.tabBoton, activo && estilos.tabBotonActivo]}>
      <Text style={[estilos.tabTexto, activo && estilos.tabTextoActivo]}>{texto}</Text>
    </TouchableOpacity>
  );
}

// StyleSheet dentro de una función (no a nivel de módulo): los colores dependen del tema activo,
// así que los estilos se recalculan en cada render en vez de fijarse una sola vez al cargar el
// archivo — el costo es despreciable para una pantalla de este tamaño.
function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    header: { backgroundColor: colores.navy, padding: 14, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    headerTitulo: { color: colores.amber, fontWeight: "800", fontSize: 16, letterSpacing: 1 },
    headerAcciones: { flexDirection: "row", alignItems: "center", gap: 10 },
    headerSync: { color: "#fff", fontSize: 12 },
    botonTema: { width: 32, height: 32, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
    botonTemaTexto: { fontSize: 15 },
    tabBar: { flexDirection: "row", borderTopWidth: 1, borderTopColor: colores.borde, backgroundColor: colores.superficie },
    tabBoton: { flex: 1, padding: 14, alignItems: "center", minHeight: 56, justifyContent: "center" },
    tabBotonActivo: { borderTopWidth: 3, borderTopColor: colores.navy },
    tabTexto: { color: colores.textoSecundario, fontWeight: "600" },
    tabTextoActivo: { color: colores.navyTexto },
  });
}
