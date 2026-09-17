import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { usarColores } from "../store/temaStore";
import { useDispositivo } from "../hooks/useDispositivo";
import type { ModoApp } from "../store/modoStore";

/** Se muestra una sola vez por dispositivo, justo después de iniciar sesión (ver App.tsx) — el
 *  mesero elige si esta tablet/celular va a funcionar como "Comandero" (toma de pedidos, el modo
 *  de siempre) o como "Punto de Venta" (mesas + venta + cobro + caja + administración, réplica
 *  del POS Windows). La elección se recuerda (modoStore) y no se vuelve a preguntar salvo que se
 *  use "Cambiar de modo" desde el header.
 *
 *  "Punto de Venta" nunca se ofrece a un MESERO — el backend ya rechaza cobrar/abrir caja para
 *  ese rol (ver pedidos.controller.ts/caja.controller.ts, @Roles CAJERO/SUPERVISOR/ADMIN_*), así
 *  que mostrar la tarjeta solo llevaría a un camino sin salida. */
export function SeleccionModoScreen({ rol, onElegir }: { rol: string | null; onElegir: (modo: ModoApp) => void }) {
  const colores = usarColores();
  const { esTablet } = useDispositivo();
  const estilos = crearEstilos(colores, esTablet);
  const puedeUsarPos = rol !== "MESERO";

  return (
    <View style={estilos.contenedor}>
      <Text style={estilos.titulo}>HANGAR 421</Text>
      <Text style={estilos.subtitulo}>¿Cómo vas a usar esta {esTablet ? "tablet" : "app"}?</Text>

      <View style={estilos.tarjetas}>
        <TouchableOpacity style={estilos.tarjeta} onPress={() => onElegir("comandero")}>
          <Text style={estilos.icono}>🧾</Text>
          <Text style={estilos.tarjetaTitulo}>Comandero</Text>
          <Text style={estilos.tarjetaTexto}>Tomar pedidos en las mesas y mandarlos a cocina.</Text>
        </TouchableOpacity>

        {puedeUsarPos && (
          <TouchableOpacity style={estilos.tarjeta} onPress={() => onElegir("pos")}>
            <Text style={estilos.icono}>🖥️</Text>
            <Text style={estilos.tarjetaTitulo}>Punto de Venta</Text>
            <Text style={estilos.tarjetaTexto}>Mesas, venta, cobro, caja y administración — igual que el POS Windows.</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>, esTablet: boolean) {
  return StyleSheet.create({
    contenedor: { flex: 1, backgroundColor: colores.fondo, alignItems: "center", justifyContent: "center", padding: 24 },
    titulo: { fontSize: 26, fontWeight: "800", color: colores.navyTexto },
    subtitulo: { color: colores.textoSecundario, marginTop: 6, marginBottom: 28, textAlign: "center" },
    tarjetas: { flexDirection: esTablet ? "row" : "column", gap: 16, width: "100%", maxWidth: esTablet ? 640 : 380 },
    tarjeta: {
      flex: 1, backgroundColor: colores.superficie, borderRadius: 20, padding: 24, alignItems: "center",
      borderWidth: 1, borderColor: colores.borde, minHeight: 160, justifyContent: "center",
    },
    icono: { fontSize: 40, marginBottom: 10 },
    tarjetaTitulo: { fontSize: 18, fontWeight: "800", color: colores.texto, marginBottom: 6 },
    tarjetaTexto: { fontSize: 13, color: colores.textoSecundario, textAlign: "center" },
  });
}
