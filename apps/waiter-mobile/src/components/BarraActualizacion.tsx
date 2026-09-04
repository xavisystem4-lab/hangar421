import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { APP_VERSION, buscarActualizacion, type InfoActualizacion } from "../updates";
import { colores } from "../theme";

type Estado = "buscando" | "disponible" | "al-dia" | "error";

/** Footer fijo: versión instalada a la izquierda, botón de actualización a la derecha — mismo
 *  patrón que BarraActualizacion.tsx del POS Windows, adaptado a que aquí no hay auto-updater
 *  nativo (la app se distribuye como .apk fuera de Play Store): el botón abre el navegador para
 *  descargar el .apk más nuevo publicado en GitHub Releases (ver ../updates.ts). */
export function BarraActualizacion() {
  const [estado, setEstado] = useState<Estado>("buscando");
  const [info, setInfo] = useState<InfoActualizacion | null>(null);

  async function buscar() {
    setEstado("buscando");
    try {
      const encontrada = await buscarActualizacion();
      if (encontrada) {
        setInfo(encontrada);
        setEstado("disponible");
      } else {
        setEstado("al-dia");
      }
    } catch {
      setEstado("error");
    }
  }

  useEffect(() => {
    buscar();
  }, []);

  function manejarPress() {
    if (estado === "disponible" && info) {
      Linking.openURL(info.urlDescarga);
      return;
    }
    buscar();
  }

  return (
    <View style={estilos.contenedor}>
      <Text style={estilos.version}>v{APP_VERSION} — Desarrollado por Soft Gala</Text>
      <TouchableOpacity onPress={manejarPress} disabled={estado === "buscando"} style={estilos.boton}>
        {estado === "buscando" && <ActivityIndicator size="small" color="#fff" />}
        {estado === "disponible" && <Text style={estilos.botonTexto}>⬇ Actualizar a v{info?.version}</Text>}
        {estado === "al-dia" && <Text style={[estilos.botonTexto, { color: colores.green }]}>✓ Al día</Text>}
        {estado === "error" && <Text style={[estilos.botonTexto, { color: colores.red }]}>⚠ Reintentar</Text>}
      </TouchableOpacity>
    </View>
  );
}

const estilos = StyleSheet.create({
  contenedor: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: colores.navy,
  },
  version: { color: "rgba(255,255,255,0.7)", fontSize: 11 },
  boton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.12)",
    minWidth: 90,
    alignItems: "center",
  },
  botonTexto: { color: "#fff", fontSize: 11, fontWeight: "600" },
});
