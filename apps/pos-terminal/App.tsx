import { useEffect, useState } from "react";
import { ActivityIndicator, SafeAreaView, StatusBar, Text, View } from "react-native";
import { useTemaStore, usarColores } from "./src/store/temaStore";
import { useAuthLocalStore } from "./src/store/authLocalStore";
import { abrirBaseDeDatos } from "./src/db/database";
import { iniciarSync, detenerSync } from "./src/sync/syncEngine";
import { LoginLocalScreen } from "./src/screens/LoginLocalScreen";
import { PosNavigator } from "./src/screens/PosNavigator";

/** Fase 2a: BD local → login offline → venta/cobro/caja (todo sin red) + motor de sync en
 *  segundo plano hacia el ERP (opcional — ver ConexionErpScreen, nunca requerido para vender).
 *  La configuración inicial completa de sucursal (fiscal/ticket/impresora, crear una sucursal
 *  NUEVA en vez de conectar a una existente) sigue pendiente en Fase 2b. */
export default function App() {
  const tema = useTemaStore();
  const auth = useAuthLocalStore();
  const colores = usarColores();
  const [dbLista, setDbLista] = useState(false);
  const [errorDb, setErrorDb] = useState<string | null>(null);

  useEffect(() => {
    tema.cargar();
  }, []);

  useEffect(() => {
    abrirBaseDeDatos()
      .then(() => setDbLista(true))
      .catch((e) => setErrorDb(e.message ?? "No se pudo abrir la base de datos local"));
  }, []);

  useEffect(() => {
    if (dbLista) auth.cargarUsuarios();
  }, [dbLista]);

  // El motor de sync corre solo mientras haya alguien logeado localmente — no tiene sentido
  // drenar la cola sin una sesión activa, y así se detiene solo al cerrar sesión.
  useEffect(() => {
    if (!auth.usuario) return;
    iniciarSync();
    return () => detenerSync();
  }, [auth.usuario]);

  if (errorDb) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colores.navy, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Text style={{ color: "#fff", textAlign: "center" }}>{errorDb}</Text>
      </SafeAreaView>
    );
  }

  if (tema.cargando || !dbLista || auth.cargando) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colores.navy, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colores.amber} size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colores.fondo }}>
      <StatusBar barStyle="light-content" backgroundColor={colores.navy} />
      <View style={{ flex: 1 }}>
        {!auth.usuario ? <LoginLocalScreen /> : <PosNavigator />}
      </View>
    </SafeAreaView>
  );
}
