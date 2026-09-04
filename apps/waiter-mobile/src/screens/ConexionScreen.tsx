import { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useConexionStore } from "../store/conexionStore";
import { usarColores } from "../store/temaStore";

/** Módulo de conexión: pide la IP y el puerto de la Estación (el equipo donde está instalado
 *  el software — puede ser el backend embebido del POS en la red local, o el backend en la nube)
 *  y valida que responda antes de guardar. Se muestra al iniciar si aún no hay Estación
 *  configurada, o en cualquier momento cuando la conexión se pierde (el heartbeat del store la
 *  detecta solo, cada 15s). También es accesible manualmente desde la pantalla de login. */
export function ConexionScreen({ onConectado, onCancelar }: { onConectado?: () => void; onCancelar?: () => void }) {
  const { host, puerto, estado, ultimoError, probarYGuardar } = useConexionStore();
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const [ip, setIp] = useState(host);
  const [pto, setPto] = useState(puerto);
  const [probando, setProbando] = useState(false);

  async function conectar() {
    setProbando(true);
    const ok = await probarYGuardar(ip.trim(), pto.trim());
    setProbando(false);
    if (ok) onConectado?.();
  }

  const verificando = probando || estado === "verificando";

  return (
    <View style={estilos.contenedor}>
      <View style={estilos.tarjeta}>
        <Text style={estilos.titulo}>HANGAR 421</Text>
        <Text style={estilos.subtitulo}>Conectar con la Estación</Text>
        <Text style={estilos.ayuda}>
          Ingresa la IP y el puerto del equipo donde está instalado el software (la Estación). Es la misma red
          Wi-Fi del local.
        </Text>

        <TextInput
          placeholder="IP de la Estación (p.ej. 192.168.1.10)"
          placeholderTextColor={colores.textoSecundario}
          value={ip}
          onChangeText={setIp}
          autoCapitalize="none"
          keyboardType="numbers-and-punctuation"
          style={estilos.input}
        />
        <TextInput
          placeholder="Puerto (p.ej. 3000)"
          placeholderTextColor={colores.textoSecundario}
          value={pto}
          onChangeText={setPto}
          keyboardType="number-pad"
          style={estilos.input}
        />

        {estado === "conectado" && (
          <Text style={estilos.ok}>✓ Conectado a la Estación {host}:{puerto}</Text>
        )}
        {estado === "error" && ultimoError && <Text style={estilos.error}>⚠ {ultimoError}</Text>}

        <TouchableOpacity style={estilos.boton} onPress={conectar} disabled={verificando || !ip.trim() || !pto.trim()}>
          {verificando ? <ActivityIndicator color="#fff" /> : <Text style={estilos.botonTexto}>Conectar</Text>}
        </TouchableOpacity>

        {onCancelar && (
          <TouchableOpacity style={estilos.cancelar} onPress={onCancelar}>
            <Text style={estilos.cancelarTexto}>Cancelar</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    contenedor: { flex: 1, backgroundColor: colores.navy, alignItems: "center", justifyContent: "center", padding: 20 },
    tarjeta: { backgroundColor: colores.superficie, borderRadius: 20, padding: 28, width: "100%", maxWidth: 380 },
    titulo: { fontSize: 26, fontWeight: "800", color: colores.navyTexto, textAlign: "center" },
    subtitulo: { textAlign: "center", color: colores.textoSecundario, marginBottom: 10, fontWeight: "600" },
    ayuda: { textAlign: "center", color: colores.textoSecundario, fontSize: 12, marginBottom: 16, lineHeight: 17 },
    input: { borderWidth: 1, borderColor: colores.borde, borderRadius: 10, padding: 14, marginTop: 10, fontSize: 16, color: colores.texto },
    ok: { color: colores.green, marginTop: 12, textAlign: "center", fontWeight: "600" },
    error: { color: colores.red, marginTop: 12, textAlign: "center" },
    boton: {
      backgroundColor: colores.navy,
      borderRadius: 12,
      padding: 16,
      marginTop: 18,
      minHeight: 56,
      alignItems: "center",
      justifyContent: "center",
    },
    botonTexto: { color: "#fff", fontWeight: "700", fontSize: 16 },
    cancelar: { marginTop: 12, alignItems: "center", padding: 6 },
    cancelarTexto: { color: colores.textoSecundario, fontSize: 13 },
  });
}
