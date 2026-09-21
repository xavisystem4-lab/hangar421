import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { usarColores } from "../store/temaStore";
import type { SucursalTerminal } from "../db/multisucursalRepo";

/**
 * Lista de sucursales para elegir la de la sesión (terminal multisucursal). Solo muestra las que
 * la persona tiene asignadas en el ERP y la terminal puede operar: no hay forma de elegir una
 * ajena. Cada venta queda con la sucursal elegida aquí.
 */
export function SelectorSucursal({
  titulo,
  opciones,
  actual,
  onElegir,
  onCancelar,
}: {
  titulo: string;
  opciones: SucursalTerminal[];
  actual?: string | null;
  onElegir: (sucursal: SucursalTerminal) => void;
  onCancelar?: () => void;
}) {
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  return (
    <View style={estilos.tarjeta}>
      <Text style={estilos.titulo}>{titulo}</Text>
      <Text style={estilos.ayuda}>Las ventas que hagas quedarán registradas en la sucursal que elijas.</Text>
      {opciones.map((s) => (
        <TouchableOpacity
          key={s.id}
          onPress={() => onElegir(s)}
          style={[estilos.opcion, actual === s.id && estilos.opcionActual]}
          accessibilityLabel={`Elegir sucursal ${s.nombre}`}
        >
          <Text style={[estilos.opcionTexto, actual === s.id && estilos.opcionTextoActual]}>🏪 {s.nombre}</Text>
          {actual === s.id && <Text style={estilos.opcionTextoActual}>actual</Text>}
        </TouchableOpacity>
      ))}
      {onCancelar && (
        <TouchableOpacity onPress={onCancelar} style={estilos.cancelar}>
          <Text style={estilos.cancelarTexto}>Cancelar</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    tarjeta: { backgroundColor: colores.superficie, borderRadius: 20, padding: 24, width: "100%", maxWidth: 420, alignSelf: "center" },
    titulo: { fontSize: 20, fontWeight: "800", color: colores.texto, textAlign: "center" },
    ayuda: { fontSize: 13, color: colores.textoSecundario, textAlign: "center", marginTop: 6, marginBottom: 14 },
    opcion: {
      flexDirection: "row", justifyContent: "space-between", alignItems: "center",
      padding: 16, borderRadius: 12, borderWidth: 1, borderColor: colores.borde, backgroundColor: colores.gray50, marginBottom: 10,
    },
    opcionActual: { backgroundColor: colores.navy, borderColor: colores.navy },
    opcionTexto: { fontSize: 16, fontWeight: "700", color: colores.texto },
    opcionTextoActual: { color: "#fff", fontWeight: "700" },
    cancelar: { alignItems: "center", marginTop: 6, padding: 10 },
    cancelarTexto: { color: colores.textoSecundario, fontWeight: "600" },
  });
}
