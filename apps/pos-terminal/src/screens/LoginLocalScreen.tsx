import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { RolUsuario } from "@hangar421/shared";
import { useAuthLocalStore } from "../store/authLocalStore";
import { usarColores } from "../store/temaStore";
import { abrirBaseDeDatos } from "../db/database";
import { crearUsuarioLocal } from "../db/usuariosLocalesRepo";
import { SelectorSucursal } from "../components/SelectorSucursal";

/** Login 100% offline — el PIN se valida contra pin_cache (ver authLocalStore), nunca contra la
 *  red. Si no hay ningún usuario local todavía (primera vez, o recién instalada), se ofrece un
 *  alta rápida — el equivalente Fase-1 del paso real de "adoptar dispositivo" en línea (Fase
 *  2b), documentado como tal en usuariosLocalesRepo.crearUsuarioLocal(). */
export function LoginLocalScreen() {
  const { usuariosDisponibles, cargando, error, cargarUsuarios, entrar, eligiendoSucursal, elegirSucursal, salir } = useAuthLocalStore();
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const [seleccionado, setSeleccionado] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [entrando, setEntrando] = useState(false);

  const [mostrarAlta, setMostrarAlta] = useState(false);
  const [nombreNuevo, setNombreNuevo] = useState("");
  const [pinNuevo, setPinNuevo] = useState("");
  const [rolNuevo, setRolNuevo] = useState<RolUsuario>(RolUsuario.CAJERO);
  const [creando, setCreando] = useState(false);

  useEffect(() => {
    cargarUsuarios();
  }, []);

  async function iniciarSesion() {
    if (!seleccionado || !pin) return;
    setEntrando(true);
    try {
      await entrar(seleccionado, pin);
    } catch {
      // el store ya refleja el error
    } finally {
      setEntrando(false);
    }
  }

  async function crearUsuario() {
    if (!nombreNuevo.trim() || pinNuevo.length < 4) return;
    setCreando(true);
    try {
      const db = await abrirBaseDeDatos();
      await crearUsuarioLocal(db, { nombre: nombreNuevo.trim(), rol: rolNuevo, pin: pinNuevo });
      setNombreNuevo("");
      setPinNuevo("");
      setRolNuevo(RolUsuario.CAJERO);
      setMostrarAlta(false);
      await cargarUsuarios();
    } finally {
      setCreando(false);
    }
  }

  // Terminal multisucursal: el PIN ya se validó y la persona tiene varias sucursales asignadas.
  if (eligiendoSucursal) {
    return (
      <ScrollView style={estilos.contenedor} contentContainerStyle={{ padding: 20, justifyContent: "center", flexGrow: 1 }}>
        <SelectorSucursal
          titulo={`Hola, ${eligiendoSucursal.usuario.nombre}. ¿En qué sucursal vas a trabajar?`}
          opciones={eligiendoSucursal.opciones}
          onElegir={(s) => { elegirSucursal(s); setPin(""); }}
          onCancelar={() => { salir(); setPin(""); }}
        />
      </ScrollView>
    );
  }

  if (cargando) {
    return (
      <View style={estilos.contenedor}>
        <ActivityIndicator color={colores.amber} size="large" />
      </View>
    );
  }

  return (
    <ScrollView style={estilos.contenedor} contentContainerStyle={{ padding: 20, justifyContent: "center", flexGrow: 1 }}>
      <View style={estilos.tarjeta}>
        <Text style={estilos.titulo}>HANGAR 421</Text>
        <Text style={estilos.subtitulo}>Punto de Venta</Text>

        {usuariosDisponibles.length === 0 && !mostrarAlta && (
          <Text style={estilos.ayuda}>No hay ningún usuario dado de alta en este dispositivo todavía.</Text>
        )}

        {usuariosDisponibles.length > 0 && (
          <View style={estilos.grilla}>
            {usuariosDisponibles.map((u) => (
              <TouchableOpacity key={u.id} onPress={() => setSeleccionado(u.id)} style={[estilos.usuario, seleccionado === u.id && estilos.usuarioActivo]}>
                <Text style={[estilos.usuarioNombre, seleccionado === u.id && estilos.usuarioNombreActivo]}>{u.nombre}</Text>
                <Text style={[estilos.usuarioRol, seleccionado === u.id && estilos.usuarioNombreActivo]}>{u.rol}</Text>
                {/* Asignado en el ERP pero nunca entró en esta tablet: su primera entrada valida
                    el PIN en línea (ver authLocalStore.entrar). */}
                {u.requiereConexion && (
                  <Text style={[estilos.usuarioRol, seleccionado === u.id && estilos.usuarioNombreActivo]}>1.ª vez · en línea</Text>
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {usuariosDisponibles.length > 0 && (
          <>
            <TextInput
              placeholder={seleccionado ? "PIN" : "Elige tu nombre arriba"}
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
              onPress={iniciarSesion}
              disabled={entrando || !seleccionado || !pin}
            >
              <Text style={estilos.botonTexto}>{entrando ? "Entrando…" : "Entrar"}</Text>
            </TouchableOpacity>
          </>
        )}

        <TouchableOpacity onPress={() => setMostrarAlta((v) => !v)} style={estilos.enlaceAlta}>
          <Text style={estilos.enlaceAltaTexto}>{mostrarAlta ? "Cancelar" : "+ Dar de alta un usuario en este dispositivo"}</Text>
        </TouchableOpacity>

        {mostrarAlta && (
          <View style={estilos.panelAlta}>
            <TextInput placeholder="Nombre" placeholderTextColor={colores.textoSecundario} value={nombreNuevo} onChangeText={setNombreNuevo} style={estilos.input} />
            <TextInput placeholder="PIN (mínimo 4 dígitos)" placeholderTextColor={colores.textoSecundario} value={pinNuevo} onChangeText={setPinNuevo} secureTextEntry keyboardType="number-pad" style={estilos.input} />
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}>
              <TouchableOpacity onPress={() => setRolNuevo(RolUsuario.CAJERO)} style={[estilos.chipRol, rolNuevo === RolUsuario.CAJERO && estilos.chipRolActivo]}>
                <Text style={{ color: rolNuevo === RolUsuario.CAJERO ? "#fff" : colores.texto, fontSize: 13 }}>Cajero</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setRolNuevo(RolUsuario.ADMIN_SUCURSAL)} style={[estilos.chipRol, rolNuevo === RolUsuario.ADMIN_SUCURSAL && estilos.chipRolActivo]}>
                <Text style={{ color: rolNuevo === RolUsuario.ADMIN_SUCURSAL ? "#fff" : colores.texto, fontSize: 13 }}>Admin</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity onPress={crearUsuario} disabled={creando || !nombreNuevo.trim() || pinNuevo.length < 4} style={estilos.boton}>
              <Text style={estilos.botonTexto}>{creando ? "Creando…" : "Crear usuario"}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    contenedor: { flex: 1, backgroundColor: colores.navy },
    tarjeta: { backgroundColor: colores.superficie, borderRadius: 20, padding: 28, width: "100%", maxWidth: 420, alignSelf: "center" },
    titulo: { fontSize: 26, fontWeight: "800", color: colores.navyTexto, textAlign: "center" },
    subtitulo: { textAlign: "center", color: colores.textoSecundario, marginBottom: 16 },
    ayuda: { textAlign: "center", color: colores.textoSecundario, fontSize: 13, marginVertical: 12 },
    grilla: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 10, marginBottom: 10 },
    usuario: { alignItems: "center", width: 100, padding: 10, borderRadius: 12, backgroundColor: colores.gray50, borderWidth: 1, borderColor: colores.borde },
    usuarioActivo: { backgroundColor: colores.navy, borderColor: colores.navy },
    usuarioNombre: { fontSize: 13, fontWeight: "700", color: colores.texto, textAlign: "center" },
    usuarioRol: { fontSize: 11, color: colores.textoSecundario, marginTop: 2 },
    usuarioNombreActivo: { color: "#fff" },
    input: { borderWidth: 1, borderColor: colores.borde, borderRadius: 10, padding: 14, marginTop: 10, fontSize: 16, color: colores.texto },
    error: { color: colores.red, marginTop: 8, textAlign: "center" },
    boton: { backgroundColor: colores.green, borderRadius: 12, padding: 16, marginTop: 14, minHeight: 52, alignItems: "center", justifyContent: "center" },
    botonDeshabilitado: { opacity: 0.5 },
    botonTexto: { color: "#fff", fontWeight: "700", fontSize: 16 },
    enlaceAlta: { marginTop: 18, alignItems: "center" },
    enlaceAltaTexto: { color: colores.navyTexto, fontSize: 13, fontWeight: "600" },
    panelAlta: { marginTop: 14, borderTopWidth: 1, borderTopColor: colores.borde, paddingTop: 14 },
    chipRol: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 10, backgroundColor: colores.gray50, borderWidth: 1, borderColor: colores.borde },
    chipRolActivo: { backgroundColor: colores.navy, borderColor: colores.navy },
  });
}
