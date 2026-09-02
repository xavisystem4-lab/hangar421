import { useState } from "react";
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useAuthStore } from "../store/authStore";
import { colores } from "../theme";

export function LoginScreen() {
  const { loginPin, error } = useAuthStore();
  const [usuarioId, setUsuarioId] = useState("");
  const [pin, setPin] = useState("");
  const [sucursalId, setSucursalId] = useState("");
  const [cargando, setCargando] = useState(false);

  async function entrar() {
    setCargando(true);
    try {
      await loginPin(usuarioId, pin, sucursalId);
    } catch {
      // el store ya refleja el error
    } finally {
      setCargando(false);
    }
  }

  return (
    <View style={estilos.contenedor}>
      <View style={estilos.tarjeta}>
        <Text style={estilos.titulo}>HANGAR 421</Text>
        <Text style={estilos.subtitulo}>Meseros</Text>

        <TextInput placeholder="ID de sucursal" value={sucursalId} onChangeText={setSucursalId} style={estilos.input} />
        <TextInput placeholder="ID de usuario" value={usuarioId} onChangeText={setUsuarioId} style={estilos.input} />
        <TextInput placeholder="PIN" value={pin} onChangeText={setPin} secureTextEntry keyboardType="number-pad" style={estilos.input} />

        {error && <Text style={estilos.error}>{error}</Text>}

        <TouchableOpacity style={estilos.boton} onPress={entrar} disabled={cargando}>
          <Text style={estilos.botonTexto}>{cargando ? "Ingresando…" : "Entrar"}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const estilos = StyleSheet.create({
  contenedor: { flex: 1, backgroundColor: colores.navy, alignItems: "center", justifyContent: "center", padding: 20 },
  tarjeta: { backgroundColor: "#fff", borderRadius: 20, padding: 28, width: "100%", maxWidth: 380 },
  titulo: { fontSize: 26, fontWeight: "800", color: colores.navy, textAlign: "center" },
  subtitulo: { textAlign: "center", color: colores.gray400, marginBottom: 16 },
  input: { borderWidth: 1, borderColor: colores.gray200, borderRadius: 10, padding: 14, marginTop: 10, fontSize: 16 },
  error: { color: colores.red, marginTop: 8 },
  boton: { backgroundColor: colores.green, borderRadius: 12, padding: 16, marginTop: 18, minHeight: 56, alignItems: "center", justifyContent: "center" },
  botonTexto: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
