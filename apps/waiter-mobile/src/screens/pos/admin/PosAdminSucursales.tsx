import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { apiFetch } from "../../../api/http";
import { useAuthStore } from "../../../store/authStore";
import { usarColores } from "../../../store/temaStore";

interface Sucursal {
  id: string;
  nombre: string;
  direccion?: string | null;
  horarioApertura?: string | null;
  horarioCierre?: string | null;
  tasaImpuesto: number;
}

/** Alta y edición de sucursales — mismo módulo que AdminSucursales.tsx del POS Windows. */
export function PosAdminSucursales() {
  const { usuario } = useAuthStore();
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [nuevaDireccion, setNuevaDireccion] = useState("");
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nombreBorrador, setNombreBorrador] = useState("");

  async function cargar() {
    if (!usuario) return;
    const data = await apiFetch<Sucursal[]>(`/sucursales?empresaId=${usuario.empresaId}`);
    setSucursales(data);
  }

  useEffect(() => { cargar(); }, [usuario]); // eslint-disable-line react-hooks/exhaustive-deps

  async function crear() {
    if (!usuario || !nuevoNombre.trim()) return;
    await apiFetch("/sucursales", { method: "POST", body: JSON.stringify({ empresaId: usuario.empresaId, nombre: nuevoNombre.trim(), direccion: nuevaDireccion.trim() }) });
    setNuevoNombre("");
    setNuevaDireccion("");
    cargar();
  }

  function empezarEdicion(s: Sucursal) {
    setEditandoId(s.id);
    setNombreBorrador(s.nombre);
  }

  async function guardarNombre(id: string) {
    if (!nombreBorrador.trim()) return;
    await apiFetch(`/sucursales/${id}`, { method: "PUT", body: JSON.stringify({ nombre: nombreBorrador.trim() }) });
    setEditandoId(null);
    cargar();
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colores.fondo }} contentContainerStyle={{ padding: 16 }}>
      <Text style={estilos.titulo}>Sucursales</Text>

      {sucursales.map((s) => (
        <View key={s.id} style={estilos.tarjeta}>
          {editandoId === s.id ? (
            <TextInput value={nombreBorrador} onChangeText={setNombreBorrador} autoFocus style={estilos.inputTitulo} />
          ) : (
            <Text style={estilos.nombre}>{s.nombre}</Text>
          )}
          <Text style={estilos.detalle}>{s.direccion ?? "Sin dirección"}</Text>
          <Text style={estilos.detalle}>Horario: {s.horarioApertura ?? "—"} – {s.horarioCierre ?? "—"}</Text>
          <Text style={estilos.detalle}>IVA: {(Number(s.tasaImpuesto) * 100).toFixed(0)}%</Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            {editandoId === s.id ? (
              <>
                <TouchableOpacity onPress={() => guardarNombre(s.id)} style={estilos.botonChico}><Text style={estilos.botonChicoTextoVerde}>Guardar</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => setEditandoId(null)} style={[estilos.botonChico, { backgroundColor: colores.gray200 }]}><Text style={{ color: colores.texto }}>Cancelar</Text></TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity onPress={() => empezarEdicion(s)} style={[estilos.botonChico, { backgroundColor: colores.gray50 }]}><Text style={{ color: colores.texto }}>Editar nombre</Text></TouchableOpacity>
            )}
          </View>
        </View>
      ))}

      <View style={estilos.tarjeta}>
        <Text style={estilos.subtitulo}>Nueva sucursal</Text>
        <TextInput placeholder="Nombre" placeholderTextColor={colores.textoSecundario} value={nuevoNombre} onChangeText={setNuevoNombre} style={estilos.input} />
        <TextInput placeholder="Dirección" placeholderTextColor={colores.textoSecundario} value={nuevaDireccion} onChangeText={setNuevaDireccion} style={estilos.input} />
        <TouchableOpacity onPress={crear} style={estilos.botonPrincipal}><Text style={estilos.botonPrincipalTexto}>Crear sucursal</Text></TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    titulo: { fontSize: 22, fontWeight: "800", color: colores.texto, marginBottom: 14 },
    subtitulo: { fontSize: 16, fontWeight: "800", color: colores.texto, marginBottom: 8 },
    tarjeta: { backgroundColor: colores.superficie, borderRadius: 14, padding: 16, marginBottom: 14 },
    nombre: { fontSize: 16, fontWeight: "800", color: colores.texto },
    detalle: { fontSize: 13, color: colores.textoSecundario, marginTop: 2 },
    inputTitulo: { borderWidth: 1, borderColor: colores.borde, borderRadius: 8, padding: 8, fontSize: 16, fontWeight: "700", color: colores.texto },
    input: { borderWidth: 1, borderColor: colores.borde, borderRadius: 8, padding: 10, marginBottom: 8, color: colores.texto },
    botonChico: { backgroundColor: colores.green, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
    botonChicoTextoVerde: { color: "#fff", fontWeight: "700", fontSize: 13 },
    botonPrincipal: { backgroundColor: colores.green, borderRadius: 10, padding: 14, alignItems: "center", marginTop: 4 },
    botonPrincipalTexto: { color: "#fff", fontWeight: "700" },
  });
}
