import { useEffect, useState } from "react";
import { ActivityIndicator, SafeAreaView, StatusBar, Text, View } from "react-native";
import { useTemaStore, usarColores } from "./src/store/temaStore";
import { useAuthLocalStore } from "./src/store/authLocalStore";
import { abrirBaseDeDatos } from "./src/db/database";
import { LoginLocalScreen } from "./src/screens/LoginLocalScreen";
import { PosNavigator } from "./src/screens/PosNavigator";

/** Fase 1: BD local → login offline → venta/cobro/caja, todo sin red. La configuración inicial
 *  real de sucursal + conexión ERP opcional (Fase 2b) y el motor de sync (Fase 2a) todavía no
 *  existen — por ahora la sucursal/empresa/dispositivo son placeholders locales (ver
 *  dispositivoLocal.ts) que se reemplazan sin tocar ninguna venta ya guardada. */
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
