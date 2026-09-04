import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { apiFetch } from "../api/http";
import { useAuthStore } from "../store/authStore";
import { useConexionStore } from "../store/conexionStore";
import { useTemaStore, usarColores } from "../store/temaStore";

interface UsuarioLogin {
  id: string;
  nombre: string;
  email: string;
  rol: string | null;
  sucursalId: string | null;
}

/** Iniciales para el avatar del selector — mismo criterio que el selector del POS Windows
 *  (`apps/pos-desktop/src/screens/Login.tsx`). */
function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/);
  return ((partes[0]?.[0] ?? "") + (partes[1]?.[0] ?? "")).toUpperCase();
}

export function LoginScreen({ onConfigurarEstacion }: { onConfigurarEstacion?: () => void }) {
  const { loginPin, error } = useAuthStore();
  const { host, puerto } = useConexionStore();
  const tema = useTemaStore();
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const [meseros, setMeseros] = useState<UsuarioLogin[] | null>(null);
  const [errorMeseros, setErrorMeseros] = useState<string | null>(null);
  const [seleccionado, setSeleccionado] = useState<UsuarioLogin | null>(null);
  const [pin, setPin] = useState("");
  const [cargando, setCargando] = useState(false);

  // Lista pública de personal activo (`/auth/usuarios-login`, sin autenticar — ver auth.service.ts)
  // filtrada a solo MESERO: el mesero ya no necesita saber ni escribir su ID de usuario ni el ID
  // de sucursal, elige su nombre en la lista y la sucursal viaja con el registro elegido.
  useEffect(() => {
    apiFetch<UsuarioLogin[]>("/auth/usuarios-login")
      .then((usuarios) => setMeseros(usuarios.filter((u) => u.rol === "MESERO")))
      .catch((e) => setErrorMeseros(e.message ?? "No se pudo cargar la lista de meseros"));
  }, []);

  function elegir(usuario: UsuarioLogin) {
    setSeleccionado(usuario);
    setPin("");
  }

  async function entrar() {
    if (!seleccionado?.sucursalId) return;
    setCargando(true);
    try {
      await loginPin(seleccionado.id, pin, seleccionado.sucursalId);
    } catch {
      // el store ya refleja el error
    } finally {
      setCargando(false);
    }
  }

  return (
    <View style={estilos.contenedor}>
      <View style={estilos.tarjeta}>
        <TouchableOpacity
          onPress={tema.alternar}
          style={estilos.botonTema}
          accessibilityLabel={tema.tema === "oscuro" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
        >
          <Text style={{ fontSize: 16 }}>{tema.tema === "oscuro" ? "☀️" : "🌙"}</Text>
        </TouchableOpacity>

        <Text style={estilos.titulo}>HANGAR 421</Text>
        <Text style={estilos.subtitulo}>Meseros</Text>

        {!meseros && !errorMeseros && <ActivityIndicator color={colores.navyTexto} style={{ marginVertical: 16 }} />}
        {errorMeseros && <Text style={estilos.error}>{errorMeseros}</Text>}
        {meseros && meseros.length === 0 && <Text style={estilos.ayuda}>No hay meseros dados de alta todavía.</Text>}

        {meseros && meseros.length > 0 && (
          <View style={estilos.grilla}>
            {meseros.map((u) => {
              const activo = seleccionado?.id === u.id;
              return (
                <TouchableOpacity key={u.id} onPress={() => elegir(u)} style={[estilos.usuario, activo && estilos.usuarioActivo]}>
                  <View style={[estilos.avatar, activo && estilos.avatarActivo]}>
                    <Text style={estilos.avatarTexto}>{iniciales(u.nombre)}</Text>
                  </View>
                  <Text style={[estilos.usuarioNombre, activo && estilos.usuarioNombreActivo]} numberOfLines={1}>
                    {u.nombre}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        <TextInput
          placeholder={seleccionado ? `PIN de ${seleccionado.nombre}` : "Elige tu nombre arriba"}
          placeholderTextColor={colores.textoSecundario}
          value={pin}
          onChangeText={setPin}
          editable={!!seleccionado}
          secureTextEntry
          keyboardType="number-pad"
          style={estilos.input}
        />

        {error && <Text style={estilos.error}>{error}</Text>}

        <TouchableOpacity
          style={[estilos.boton, (!seleccionado || !pin) && estilos.botonDeshabilitado]}
          onPress={entrar}
          disabled={cargando || !seleccionado || !pin}
        >
          <Text style={estilos.botonTexto}>{cargando ? "Ingresando…" : "Entrar"}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={estilos.estacion} onPress={onConfigurarEstacion}>
          <Text style={estilos.estacionTexto}>⚙ Estación: {host}:{puerto}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    contenedor: { flex: 1, backgroundColor: colores.navy, alignItems: "center", justifyContent: "center", padding: 20 },
    tarjeta: { backgroundColor: colores.superficie, borderRadius: 20, padding: 28, width: "100%", maxWidth: 380 },
    botonTema: {
      position: "absolute", top: 14, right: 14, width: 30, height: 30, borderRadius: 15,
      backgroundColor: colores.fondo, alignItems: "center", justifyContent: "center",
    },
    titulo: { fontSize: 26, fontWeight: "800", color: colores.navyTexto, textAlign: "center" },
    subtitulo: { textAlign: "center", color: colores.textoSecundario, marginBottom: 16 },
    ayuda: { textAlign: "center", color: colores.textoSecundario, fontSize: 13, marginVertical: 12 },
    grilla: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 10, marginBottom: 6 },
    usuario: { alignItems: "center", width: 78, padding: 8, borderRadius: 12 },
    usuarioActivo: { backgroundColor: colores.navy },
    avatar: {
      width: 46, height: 46, borderRadius: 23, backgroundColor: colores.amber,
      alignItems: "center", justifyContent: "center",
    },
    avatarActivo: { backgroundColor: colores.amber },
    avatarTexto: { color: colores.navy, fontWeight: "800", fontSize: 16 },
    usuarioNombre: { marginTop: 6, fontSize: 12, fontWeight: "600", color: colores.texto, textAlign: "center" },
    usuarioNombreActivo: { color: "#fff" },
    input: { borderWidth: 1, borderColor: colores.borde, borderRadius: 10, padding: 14, marginTop: 14, fontSize: 16, color: colores.texto },
    error: { color: colores.red, marginTop: 8, textAlign: "center" },
    boton: { backgroundColor: colores.green, borderRadius: 12, padding: 16, marginTop: 18, minHeight: 56, alignItems: "center", justifyContent: "center" },
    botonDeshabilitado: { opacity: 0.5 },
    botonTexto: { color: "#fff", fontWeight: "700", fontSize: 16 },
    estacion: { marginTop: 16, alignItems: "center", padding: 6 },
    estacionTexto: { color: colores.textoSecundario, fontSize: 12 },
  });
}
