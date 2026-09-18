import { useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useAuthLocalStore } from "../store/authLocalStore";
import { usarColores } from "../store/temaStore";
import { PosVentaScreen } from "./PosVentaScreen";
import { PosCobroScreen } from "./PosCobroScreen";
import { PosCajaScreen } from "./PosCajaScreen";

type Pantalla = "venta" | "cobro" | "caja";

const TABS: { id: Pantalla; etiqueta: string }[] = [
  { id: "venta", etiqueta: "Venta" },
  { id: "caja", etiqueta: "Caja" },
];

export function PosNavigator() {
  const { usuario, salir } = useAuthLocalStore();
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const [pantalla, setPantalla] = useState<Pantalla>("venta");
  const [ultimoFolio, setUltimoFolio] = useState<{ folio: number; total: number } | null>(null);

  function confirmarSalir() {
    Alert.alert("Cerrar sesión", "¿Seguro que quieres cerrar tu sesión?", [
      { text: "Cancelar", style: "cancel" },
      { text: "Cerrar sesión", style: "destructive", onPress: salir },
    ]);
  }

  function cobroConfirmado(folio: number, total: number) {
    setUltimoFolio({ folio, total });
    setPantalla("venta");
  }

  return (
    <View style={{ flex: 1, backgroundColor: colores.fondo }}>
      <View style={estilos.header}>
        <Text style={estilos.headerTitulo}>HANGAR 421 · {usuario?.nombre}</Text>
        <TouchableOpacity onPress={confirmarSalir} style={estilos.botonHeader} accessibilityLabel="Cerrar sesión">
          <Text style={estilos.botonHeaderTexto}>🚪</Text>
        </TouchableOpacity>
      </View>

      {ultimoFolio && (
        <View style={estilos.avisoFolio}>
          <Text style={estilos.avisoFolioTexto}>✓ Venta #{ultimoFolio.folio} confirmada — ${ultimoFolio.total.toFixed(2)}</Text>
          <TouchableOpacity onPress={() => setUltimoFolio(null)}><Text style={estilos.avisoFolioCerrar}>✕</Text></TouchableOpacity>
        </View>
      )}

      <View style={{ flex: 1 }}>
        {pantalla === "venta" && <PosVentaScreen onCobrar={() => setPantalla("cobro")} />}
        {pantalla === "cobro" && <PosCobroScreen onCerrar={() => setPantalla("venta")} onCobrado={cobroConfirmado} />}
        {pantalla === "caja" && <PosCajaScreen />}
      </View>

      {pantalla !== "cobro" && (
        <View style={estilos.tabBar}>
          {TABS.map((tab) => (
            <TouchableOpacity key={tab.id} onPress={() => setPantalla(tab.id)} style={[estilos.tabBoton, pantalla === tab.id && estilos.tabBotonActivo]}>
              <Text style={[estilos.tabTexto, pantalla === tab.id && estilos.tabTextoActivo]}>{tab.etiqueta}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 14, backgroundColor: colores.navy },
    headerTitulo: { color: colores.amber, fontWeight: "800", fontSize: 15 },
    botonHeader: { width: 32, height: 32, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
    botonHeaderTexto: { fontSize: 15 },
    avisoFolio: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: colores.green, padding: 10, paddingHorizontal: 16 },
    avisoFolioTexto: { color: "#fff", fontWeight: "700", fontSize: 13 },
    avisoFolioCerrar: { color: "#fff", fontSize: 16 },
    tabBar: { flexDirection: "row", borderTopWidth: 1, borderTopColor: colores.borde, backgroundColor: colores.superficie },
    tabBoton: { flex: 1, paddingVertical: 12, alignItems: "center", minHeight: 56, justifyContent: "center" },
    tabBotonActivo: { borderTopWidth: 3, borderTopColor: colores.navy },
    tabTexto: { color: colores.textoSecundario, fontWeight: "600", fontSize: 14 },
    tabTextoActivo: { color: colores.navyTexto },
  });
}
