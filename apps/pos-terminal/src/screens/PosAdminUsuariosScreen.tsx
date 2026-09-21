import { useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { RolUsuario } from "@hangar421/shared";
import { usarColores } from "../store/temaStore";
import { abrirBaseDeDatos } from "../db/database";
import { listarUsuariosLocales, eliminarUsuarioLocal, crearUsuarioLocal, type UsuarioLocal } from "../db/usuariosLocalesRepo";
import { sincronizarPronto } from "../sync/syncEngine";

/** Usuarios locales de este dispositivo — quiénes pueden entrar con PIN aquí, y si ya quedaron
 *  registrados como Usuario real en el ERP (columna "erp_usuario_id"). El registro es automático:
 *  el alta viaja por la cola de sincronización con el mismo id (ver crearUsuarioLocal), así que
 *  un usuario creado sin conexión llega al ERP en cuanto vuelve la red, sin volver a pedir el PIN. */
export function PosAdminUsuariosScreen({ onCerrar }: { onCerrar: () => void }) {
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const [usuarios, setUsuarios] = useState<UsuarioLocal[]>([]);

  const [nombreNuevo, setNombreNuevo] = useState("");
  const [pinNuevo, setPinNuevo] = useState("");
  const [rolNuevo, setRolNuevo] = useState<RolUsuario>(RolUsuario.CAJERO);

  async function cargar() {
    const db = await abrirBaseDeDatos();
    setUsuarios(await listarUsuariosLocales(db));
  }

  useEffect(() => {
    cargar();
  }, []);

  function confirmarEliminar(u: UsuarioLocal) {
    Alert.alert("Quitar acceso local", `¿"${u.nombre}" deja de poder entrar en ESTE dispositivo? (no borra su cuenta del ERP si ya la tiene)`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Quitar acceso",
        style: "destructive",
        onPress: async () => {
          const db = await abrirBaseDeDatos();
          await eliminarUsuarioLocal(db, u.id);
          cargar();
        },
      },
    ]);
  }

  async function crearUsuario() {
    if (!nombreNuevo.trim() || pinNuevo.length < 4) return;
    const db = await abrirBaseDeDatos();
    await crearUsuarioLocal(db, { nombre: nombreNuevo.trim(), rol: rolNuevo, pin: pinNuevo });
    sincronizarPronto();
    setNombreNuevo("");
    setPinNuevo("");
    setRolNuevo(RolUsuario.CAJERO);
    cargar();
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colores.fondo }} contentContainerStyle={{ padding: 16 }}>
      <View style={estilos.encabezado}>
        <Text style={estilos.titulo}>Usuarios de este dispositivo</Text>
        <TouchableOpacity onPress={onCerrar}><Text style={estilos.cerrar}>✕</Text></TouchableOpacity>
      </View>

      {usuarios.map((u) => (
        <View key={u.id} style={estilos.tarjeta}>
          <View style={estilos.filaEncabezado}>
            <Text style={estilos.nombre}>{u.nombre}</Text>
            <Text style={[estilos.pildora, u.erpUsuarioId ? estilos.pildoraOk : estilos.pildoraPendiente]}>
              {u.erpUsuarioId ? "✓ En el ERP" : "Pendiente de sincronizar"}
            </Text>
          </View>
          <Text style={estilos.rol}>{u.rol}</Text>

          <View style={{ flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <TouchableOpacity onPress={() => confirmarEliminar(u)} style={[estilos.botonChico, { backgroundColor: colores.red + "22" }]}>
              <Text style={{ color: colores.red, fontSize: 12 }}>Quitar acceso local</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}

      <View style={estilos.tarjeta}>
        <Text style={estilos.subtitulo}>Nuevo usuario</Text>
        <Text style={estilos.ayuda}>Se registra en el ERP automáticamente, también si ahora no hay conexión: sale en cuanto vuelva la red.</Text>
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
        <TouchableOpacity onPress={crearUsuario} disabled={!nombreNuevo.trim() || pinNuevo.length < 4} style={estilos.botonPrincipal}>
          <Text style={estilos.botonPrincipalTexto}>Crear usuario</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    encabezado: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
    titulo: { fontSize: 20, fontWeight: "800", color: colores.texto },
    cerrar: { color: colores.textoSecundario, fontSize: 20 },
    filaEncabezado: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    nombre: { fontSize: 16, fontWeight: "800", color: colores.texto },
    rol: { fontSize: 12, color: colores.textoSecundario, marginTop: 2 },
    pildora: { fontSize: 11, fontWeight: "700", paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, overflow: "hidden" },
    pildoraOk: { backgroundColor: "#1F9D5522", color: "#1F9D55" },
    pildoraPendiente: { backgroundColor: "#9CA3AF22", color: "#6B7280" },
    subtitulo: { fontSize: 15, fontWeight: "800", color: colores.texto, marginBottom: 6 },
    ayuda: { fontSize: 12, color: colores.textoSecundario, marginBottom: 10 },
    tarjeta: { backgroundColor: colores.superficie, borderRadius: 14, padding: 16, marginBottom: 12 },
    input: { borderWidth: 1, borderColor: colores.borde, borderRadius: 8, padding: 10, marginBottom: 8, color: colores.texto },
    botonChico: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
    botonPrincipal: { backgroundColor: colores.green, borderRadius: 10, padding: 14, alignItems: "center", marginTop: 4 },
    botonPrincipalTexto: { color: "#fff", fontWeight: "700" },
    chipRol: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: colores.gray50, borderWidth: 1, borderColor: colores.borde },
    chipRolActivo: { backgroundColor: colores.navy, borderColor: colores.navy },
  });
}
