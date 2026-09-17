import { useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { usarColores } from "../../../store/temaStore";
import { PosAdminSucursales } from "./PosAdminSucursales";
import { PosAdminMesas } from "./PosAdminMesas";
import { PosAdminTerminales } from "./PosAdminTerminales";
import { PosAdminPlataformas } from "./PosAdminPlataformas";

// Los módulos se agregan por fase (2a: Sucursales/Mesas/Terminales/Plataformas). Las fases
// siguientes (2b Catálogo/Usuarios, 2c Reportes, 2d Inventario, 2e Ticket, 2f Conexión) se
// suman aquí mismo, sin tocar el patrón.
type Modulo = "sucursales" | "mesas" | "terminales" | "plataformas";

const MODULOS: { id: Modulo; etiqueta: string }[] = [
  { id: "sucursales", etiqueta: "Sucursales" },
  { id: "mesas", etiqueta: "Mesas" },
  { id: "terminales", etiqueta: "Terminales" },
  { id: "plataformas", etiqueta: "Plataformas" },
];

/** Contenedor de Administración dentro de Punto de Venta — mismo patrón de tabs por `useState`
 *  que Administracion.tsx del POS Windows, solo que aquí la barra de tabs va horizontal y
 *  desplazable (ScrollView) porque en tablet hay menos ancho que en escritorio. */
export function PosAdminHomeScreen() {
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const [modulo, setModulo] = useState<Modulo>("sucursales");

  return (
    <View style={{ flex: 1, backgroundColor: colores.fondo }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={estilos.barra} contentContainerStyle={{ gap: 8, paddingHorizontal: 12 }}>
        {MODULOS.map((m) => {
          const activo = modulo === m.id;
          return (
            <TouchableOpacity key={m.id} onPress={() => setModulo(m.id)} style={[estilos.tab, activo && estilos.tabActivo]}>
              <Text style={{ color: activo ? "#fff" : colores.texto, fontSize: 13, fontWeight: "700" }}>{m.etiqueta}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={{ flex: 1 }}>
        {modulo === "sucursales" && <PosAdminSucursales />}
        {modulo === "mesas" && <PosAdminMesas />}
        {modulo === "terminales" && <PosAdminTerminales />}
        {modulo === "plataformas" && <PosAdminPlataformas />}
      </View>
    </View>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    barra: { flexGrow: 0, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colores.borde, backgroundColor: colores.superficie },
    tab: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: colores.gray50 },
    tabActivo: { backgroundColor: colores.navy },
  });
}
