import { useEffect, useState } from "react";
import { ActivityIndicator, SafeAreaView, StatusBar, StyleSheet, Text, View } from "react-native";
import { useTemaStore, usarColores } from "./src/store/temaStore";
import { abrirBaseDeDatos } from "./src/db/database";

/** Fase 0 — solo abre la BD local (corre las migraciones) y muestra una pantalla de espera. Las
 *  fases siguientes agregan: catálogo/venta/caja (Fase 1), motor de sync (Fase 2a),
 *  configuración inicial de sucursal (Fase 2b), etc. — ver el plan de separación de Punto de
 *  Venta en su propia APK. */
export default function App() {
  const tema = useTemaStore();
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

  const estilos = crearEstilos(colores);

  if (tema.cargando || (!dbLista && !errorDb)) {
    return (
      <SafeAreaView style={estilos.contenedor}>
        <ActivityIndicator color={colores.amber} size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={estilos.contenedor}>
      <StatusBar barStyle="light-content" backgroundColor={colores.navy} />
      {errorDb ? (
        <Text style={estilos.error}>{errorDb}</Text>
      ) : (
        <View style={estilos.centro}>
          <Text style={estilos.titulo}>HANGAR 421</Text>
          <Text style={estilos.subtitulo}>Punto de Venta</Text>
          <Text style={estilos.ayuda}>Base de datos local lista — Fase 1 en construcción.</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    contenedor: { flex: 1, backgroundColor: colores.navy, alignItems: "center", justifyContent: "center" },
    centro: { alignItems: "center", padding: 24 },
    titulo: { fontSize: 28, fontWeight: "800", color: colores.amber, letterSpacing: 1 },
    subtitulo: { fontSize: 16, color: "#fff", marginTop: 4 },
    ayuda: { fontSize: 13, color: "rgba(255,255,255,0.6)", marginTop: 20, textAlign: "center" },
    error: { color: "#fff", padding: 24, textAlign: "center" },
  });
}
