import { useEffect, useState } from "react";
import { ActivityIndicator, SafeAreaView, StatusBar, Text, View } from "react-native";
import { useTemaStore, usarColores } from "./src/store/temaStore";
import { useAuthLocalStore } from "./src/store/authLocalStore";
import { abrirBaseDeDatos } from "./src/db/database";
import { primerArranqueCompletado } from "./src/db/configFiscalRepo";
import { iniciarSync, detenerSync } from "./src/sync/syncEngine";
import { ConfiguracionInicialScreen } from "./src/screens/ConfiguracionInicialScreen";
import { LoginLocalScreen } from "./src/screens/LoginLocalScreen";
import { PosNavigator } from "./src/screens/PosNavigator";
import { BarraActualizacion } from "./src/components/BarraActualizacion";

/** Fase 2b: BD local → configuración inicial (una sola vez) → login offline → venta/cobro/caja
 *  (todo sin red) + motor de sync en segundo plano hacia el ERP (opcional — ver
 *  ConexionErpScreen, nunca requerido para vender ni para completar la configuración inicial). */
export default function App() {
  const tema = useTemaStore();
  const auth = useAuthLocalStore();
  const colores = usarColores();
  const [dbLista, setDbLista] = useState(false);
  const [errorDb, setErrorDb] = useState<string | null>(null);
  const [primerArranqueListo, setPrimerArranqueListo] = useState<boolean | null>(null);

  useEffect(() => {
    tema.cargar();
  }, []);

  useEffect(() => {
    abrirBaseDeDatos()
      .then(() => setDbLista(true))
      .catch((e) => setErrorDb(e.message ?? "No se pudo abrir la base de datos local"));
  }, []);

  useEffect(() => {
    if (!dbLista) return;
    auth.cargarUsuarios();
    abrirBaseDeDatos().then(async (db) => setPrimerArranqueListo(await primerArranqueCompletado(db)));
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

  if (tema.cargando || !dbLista || auth.cargando || primerArranqueListo === null) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colores.navy, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colores.amber} size="large" />
      </SafeAreaView>
    );
  }

  if (!primerArranqueListo) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colores.fondo }}>
        <StatusBar barStyle="light-content" backgroundColor={colores.navy} />
        <ConfiguracionInicialScreen onListo={() => setPrimerArranqueListo(true)} />
        {/* También en la configuración inicial: si un APK viejo trae un fallo justo en este
            paso, el cajero tiene que poder actualizar sin haber terminado de configurarlo. */}
        <BarraActualizacion />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colores.fondo }}>
      <StatusBar barStyle="light-content" backgroundColor={colores.navy} />
      <View style={{ flex: 1 }}>
        {!auth.usuario ? <LoginLocalScreen /> : <PosNavigator />}
      </View>
      {/* Footer fijo, visible con y sin sesión — igual que en la app de Meseros. */}
      <BarraActualizacion />
    </SafeAreaView>
  );
}
