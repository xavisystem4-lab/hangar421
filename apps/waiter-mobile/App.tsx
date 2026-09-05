import { useEffect, useState } from "react";
import { Alert, SafeAreaView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useDispositivo } from "./src/hooks/useDispositivo";
import type { Mesa } from "@hangar421/shared";
import { useAuthStore } from "./src/store/authStore";
import { useSyncStore } from "./src/store/syncStore";
import { useConexionStore } from "./src/store/conexionStore";
import { useTemaStore, usarColores } from "./src/store/temaStore";
import { iniciarSync, detenerSync } from "./src/sync/syncEngine";
import { conectarSocket, desconectarSocket } from "./src/api/socket";
import { LoginScreen } from "./src/screens/LoginScreen";
import { ConexionScreen } from "./src/screens/ConexionScreen";
import { MesasScreen } from "./src/screens/MesasScreen";
import { TomaPedidoScreen } from "./src/screens/TomaPedidoScreen";
import { MisPedidosScreen } from "./src/screens/MisPedidosScreen";
import { useOrderStore } from "./src/store/orderStore";
import { BarraActualizacion } from "./src/components/BarraActualizacion";

type Pantalla = "mesas" | "pedido" | "mispedidos" | "conexion";

export default function App() {
  const auth = useAuthStore();
  const sync = useSyncStore();
  const conexion = useConexionStore();
  const tema = useTemaStore();
  const colores = usarColores();
  const [pantalla, setPantalla] = useState<Pantalla>("mesas");
  const [mesaActiva, setMesaActiva] = useState<Mesa | null>(null);
  const [configurandoEstacion, setConfigurandoEstacion] = useState(false);

  // "Pegajoso": solo cambia con un resultado DEFINITIVO ("conectado" o "error"), nunca con
  // "verificando" — ver el efecto de abajo. Antes se leía `conexion.estado === "error"`
  // directo en el render, y el heartbeat (cada 15s) pone `estado` en "verificando" un instante
  // aunque la Estación siga sin responder iguales que antes: ese parpadeo hacía que
  // ConexionScreen se desmontara y remontara mientras el mesero estaba a media escritura de la
  // IP/puerto, borrándosela — probablemente la razón real de que "nunca lograra conectar", no
  // solo de que "se borre lo que escribo".
  const [mostrarConexion, setMostrarConexion] = useState(false);
  useEffect(() => {
    if (conexion.cargando) return;
    if (conexion.estado === "conectado") setMostrarConexion(false);
    else if (conexion.estado === "error") setMostrarConexion(true);
    // "verificando" no toca `mostrarConexion` — se queda como estaba hasta que el heartbeat
    // resuelva a uno de los otros dos estados.
  }, [conexion.estado, conexion.cargando]);

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

  // Conexión de socket de TODA la sesión (no solo mientras se ve "Mis pedidos") — así el panel
  // "Conexión Meseros" del POS (que lista tablets conectadas vía este mismo socket, ver
  // realtime.gateway.ts) refleja de verdad si el mesero sigue activo, sin importar en qué
  // pestaña esté parado.
  useEffect(() => {
    if (!auth.usuario || !auth.sucursalId || !auth.dispositivoId) return;
    conectarSocket(auth.sucursalId, auth.usuario.id, auth.usuario.nombre, auth.dispositivoId);
    return () => desconectarSocket();
  }, [auth.usuario, auth.sucursalId, auth.dispositivoId]);

  const { esTablet } = useDispositivo();
  const estilos = crearEstilos(colores, esTablet);

  // `sync.estado` por sí solo NO detecta que la Estación se cayó si la cola offline está
  // vacía: procesarCola() (syncEngine.ts) solo hace un fetch real cuando hay algo pendiente
  // que sincronizar — si todo se mandó al vuelo, cada 8s simplemente reafirma "SYNCED" sin
  // volver a preguntarle al servidor, así que el header se quedaría en verde para siempre
  // aunque se apague la PC. `conexion.estado` sí verifica de verdad cada 15s (heartbeat de
  // conexionStore, corre toda la sesión — ver el useEffect de arriba), así que es la señal
  // que manda para decidir "desconectado"; se combina con un intento real de sync que sí
  // falló (OFFLINE) para no esperar hasta el siguiente heartbeat en ese caso.
  const desconectadoDeVeras = conexion.estado === "error" || sync.estado === "OFFLINE";

  function cerrarSesion() {
    // Confirmación simple — un toque accidental en medio de un pedido perdería lo que el mesero
    // llevaba capturado en esa pantalla (el borrador del pedido solo vive en memoria hasta que
    // se envía a cocina, ver orderStore). No hace falta contraseña: es la misma terminal
    // compartida, cualquier mesero puede volver a entrar con su PIN al toque.
    Alert.alert("Cerrar sesión", "¿Seguro que quieres cerrar tu sesión?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Cerrar sesión",
        style: "destructive",
        onPress: () => {
          setPantalla("mesas");
          setMesaActiva(null);
          auth.logout();
        },
      },
    ]);
  }

  if (auth.cargando || conexion.cargando || tema.cargando) return null;

  if (!auth.usuario) {
    // Antes de poder iniciar sesión hace falta saber a qué Estación (servidor) conectarse —
    // una vez logeado, si la conexión se cae, la app sigue funcionando en modo offline-first
    // (ver syncEngine/outbox) en vez de bloquear la pantalla.
    //
    // `mostrarConexion` (no `conexion.estado` directo) — ver el efecto que lo calcula arriba:
    // solo cambia con un resultado definitivo, nunca con el "verificando" transitorio del
    // heartbeat (cada 15s) — si se leyera `estado` directo, cada 15s esta pantalla cambiaría de
    // LoginScreen a ConexionScreen y de vuelta (o viceversa, si ya se estaba en ConexionScreen),
    // desmontando el formulario a medio escribir.
    if (mostrarConexion || configurandoEstacion) {
      return (
        <SafeAreaView style={{ flex: 1, backgroundColor: colores.navy }}>
          <View style={{ flex: 1 }}>
            <ConexionScreen
              onConectado={() => setConfigurandoEstacion(false)}
              onCancelar={configurandoEstacion && conexion.estado === "conectado" ? () => setConfigurandoEstacion(false) : undefined}
            />
          </View>
          {/* También visible ANTES de lograr conectar por primera vez — si el problema es un bug
              del propio APK (ej. una versión vieja que ni siquiera podía intentar la conexión),
              el mesero necesita poder bajar una versión nueva sin quedar atrapado en una
              pantalla que nunca deja pasar. */}
          <BarraActualizacion />
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
          <Text
            style={[
              estilos.headerSync,
              { color: desconectadoDeVeras ? colores.red : sync.estado === "SYNCING" ? colores.amber : colores.green },
            ]}
          >
            {desconectadoDeVeras
              ? `● Desconectado (${sync.pendientes})`
              : sync.estado === "SYNCING"
                ? "● Sincronizando…"
                : "● Conectado"}
          </Text>
          <TouchableOpacity onPress={tema.alternar} style={estilos.botonTema}>
            <Text style={estilos.botonTemaTexto}>{tema.tema === "oscuro" ? "☀️" : "🌙"}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={cerrarSesion} style={estilos.botonTema} accessibilityLabel="Cerrar sesión">
            <Text style={estilos.botonTemaTexto}>🚪</Text>
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
        {pantalla === "conexion" && <ConexionScreen />}
      </View>

      <View style={estilos.tabBar}>
        <TabBoton texto="Mesas" activo={pantalla === "mesas"} onPress={() => setPantalla("mesas")} colores={colores} />
        <TabBoton texto="Pedido" activo={pantalla === "pedido"} onPress={() => setPantalla("pedido")} colores={colores} />
        <TabBoton texto="Mis pedidos" activo={pantalla === "mispedidos"} onPress={() => setPantalla("mispedidos")} colores={colores} />
        <TabBoton texto="Conexión" activo={pantalla === "conexion"} onPress={() => setPantalla("conexion")} colores={colores} />
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
  const estilos = crearEstilos(colores, false);
  return (
    <TouchableOpacity onPress={onPress} style={[estilos.tabBoton, activo && estilos.tabBotonActivo]}>
      {/* numberOfLines + adjustsFontSizeToFit — "Mis pedidos" (la etiqueta más larga) se
          partía en dos renglones ("Mis" / "pedidos") con 4 pestañas en un celular angosto;
          esto la encoge un poco en vez de partirla. */}
      <Text
        style={[estilos.tabTexto, activo && estilos.tabTextoActivo]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.75}
      >
        {texto}
      </Text>
    </TouchableOpacity>
  );
}

// StyleSheet dentro de una función (no a nivel de módulo): los colores dependen del tema activo,
// así que los estilos se recalculan en cada render en vez de fijarse una sola vez al cargar el
// archivo — el costo es despreciable para una pantalla de este tamaño.
function crearEstilos(colores: ReturnType<typeof usarColores>, esTablet: boolean) {
  const escala = esTablet ? 1.15 : 1;
  return StyleSheet.create({
    header: { backgroundColor: colores.navy, padding: 14, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    headerTitulo: { color: colores.amber, fontWeight: "800", fontSize: 16 * escala, letterSpacing: 1 },
    headerAcciones: { flexDirection: "row", alignItems: "center", gap: 10 },
    headerSync: { color: "#fff", fontSize: 12 * escala },
    botonTema: { width: 32, height: 32, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
    botonTemaTexto: { fontSize: 15 },
    tabBar: { flexDirection: "row", borderTopWidth: 1, borderTopColor: colores.borde, backgroundColor: colores.superficie },
    tabBoton: { flex: 1, paddingHorizontal: 4, paddingVertical: 10, alignItems: "center", minHeight: 56, justifyContent: "center" },
    tabBotonActivo: { borderTopWidth: 3, borderTopColor: colores.navy },
    tabTexto: { color: colores.textoSecundario, fontWeight: "600", fontSize: 13 * escala },
    tabTextoActivo: { color: colores.navyTexto },
  });
}
