import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { APP_VERSION, buscarActualizacion, type InfoActualizacion } from "../updates";
import { usarColores } from "../store/temaStore";

type Estado = "buscando" | "disponible" | "al-dia" | "error";

/** Footer fijo: versión instalada a la izquierda, botón de actualización a la derecha — mismo
 *  patrón que la barra de la app de Meseros, adaptado al tema claro/oscuro del Punto de Venta
 *  (aquí los colores vienen del hook `usarColores`, no de un import estático).
 *
 *  No hay auto-updater nativo porque la app se distribuye como .apk fuera de Play Store: el
 *  botón abre el navegador con el .apk más nuevo publicado en GitHub Releases (ver ../updates.ts).
 *  Buscar la actualización NUNCA bloquea nada — si falla (sin red, GitHub caído, límite de la
 *  API) el botón queda en "Reintentar" y el POS sigue vendiendo con normalidad. */
export function BarraActualizacion() {
  const colores = usarColores();
  const estilos = crearEstilos(colores);
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
      Linking.openURL(info.urlDescarga).catch(() => setEstado("error"));
      return;
    }
    buscar();
  }

  return (
    <View style={estilos.contenedor}>
      <Text style={estilos.version} numberOfLines={1}>v{APP_VERSION} — Desarrollado por Soft Gala</Text>
      <TouchableOpacity
        onPress={manejarPress}
        disabled={estado === "buscando"}
        style={estilos.boton}
        accessibilityLabel={estado === "disponible" ? `Actualizar a la versión ${info?.version}` : "Buscar actualizaciones"}
      >
        {estado === "buscando" && <ActivityIndicator size="small" color="#fff" />}
        {estado === "disponible" && <Text style={estilos.botonTexto}>⬇ Actualizar a v{info?.version}</Text>}
        {estado === "al-dia" && <Text style={[estilos.botonTexto, { color: colores.green }]}>✓ Al día</Text>}
        {estado === "error" && <Text style={[estilos.botonTexto, { color: colores.red }]}>⚠ Reintentar</Text>}
      </TouchableOpacity>
    </View>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    contenedor: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: 14,
      paddingVertical: 6,
      backgroundColor: colores.navy,
    },
    version: { color: "rgba(255,255,255,0.7)", fontSize: 11, flexShrink: 1 },
    boton: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 6,
      backgroundColor: "rgba(255,255,255,0.12)",
      minWidth: 90,
      alignItems: "center",
    },
    botonTexto: { color: "#fff", fontSize: 11, fontWeight: "600" },
  });
}
