import { useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import type { Sucursal } from "@hangar421/shared";
import { apiFetch } from "../../../api/http";
import { useAuthStore } from "../../../store/authStore";
import { usarColores } from "../../../store/temaStore";

interface Mesa { id: string; nombre: string; capacidad: number; estado: string }

const ETIQUETA_ESTADO: Record<string, string> = {
  LIBRE: "Libre", OCUPADA: "Ocupada", RESERVADA: "Reservada", POR_COBRAR: "Por cobrar", PEDIDO_LISTO: "Pedido listo",
};

/** Alta, edición y baja de mesas por sucursal — mismo módulo que AdminMesas.tsx del POS Windows.
 *  "Eliminar" es baja lógica; el backend la rechaza si la mesa no está Libre. */
export function PosAdminMesas() {
  const { usuario } = useAuthStore();
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [sucursalId, setSucursalId] = useState("");
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const [nombreNueva, setNombreNueva] = useState("");
  const [capacidadNueva, setCapacidadNueva] = useState("4");
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nombreBorrador, setNombreBorrador] = useState("");
  const [capacidadBorrador, setCapacidadBorrador] = useState("4");

  async function cargar(suc: string) {
    if (!suc) return;
    const data = await apiFetch<Mesa[]>(`/mesas?sucursalId=${suc}`);
    setMesas(data);
  }

  useEffect(() => {
    if (!usuario) return;
    apiFetch<Sucursal[]>(`/sucursales?empresaId=${usuario.empresaId}`).then((s) => {
      setSucursales(s);
      if (s[0]) { setSucursalId(s[0].id); cargar(s[0].id); }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario]);

  async function crear() {
    if (!nombreNueva.trim()) return;
    await apiFetch("/mesas", { method: "POST", body: JSON.stringify({ sucursalId, nombre: nombreNueva.trim(), capacidad: Number(capacidadNueva) || 4 }) });
    setNombreNueva("");
    setCapacidadNueva("4");
    setMensaje("Mesa creada.");
    cargar(sucursalId);
  }

  function empezarEdicion(m: Mesa) {
    setEditandoId(m.id);
    setNombreBorrador(m.nombre);
    setCapacidadBorrador(String(m.capacidad));
  }

  async function guardarEdicion(id: string) {
    if (!nombreBorrador.trim()) return;
    await apiFetch(`/mesas/${id}`, { method: "PATCH", body: JSON.stringify({ nombre: nombreBorrador.trim(), capacidad: Number(capacidadBorrador) || 4 }) });
    setEditandoId(null);
    setMensaje("Mesa actualizada.");
    cargar(sucursalId);
  }

  function confirmarEliminar(m: Mesa) {
    Alert.alert("Eliminar mesa", `¿Eliminar "${m.nombre}"?`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Eliminar", style: "destructive", onPress: () => eliminar(m) },
    ]);
  }

  async function eliminar(m: Mesa) {
    try {
      await apiFetch(`/mesas/${m.id}`, { method: "PATCH", body: JSON.stringify({ activo: false }) });
      setMensaje("Mesa eliminada.");
      cargar(sucursalId);
    } catch (e: any) {
      setMensaje(e.message ?? "No se pudo eliminar la mesa.");
    }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colores.fondo }} contentContainerStyle={{ padding: 16 }}>
      <View style={estilos.filaEncabezado}>
        <Text style={estilos.titulo}>Mesas</Text>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
        {sucursales.map((s) => (
          <TouchableOpacity key={s.id} onPress={() => { setSucursalId(s.id); cargar(s.id); }} style={[estilos.chip, sucursalId === s.id && estilos.chipActivo]}>
            <Text style={{ color: sucursalId === s.id ? "#fff" : colores.texto, fontSize: 13 }}>{s.nombre}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {mensaje && <Text style={estilos.mensaje}>{mensaje}</Text>}

      {mesas.map((m) => (
        <View key={m.id} style={estilos.tarjeta}>
          {editandoId === m.id ? (
            <>
              <TextInput value={nombreBorrador} onChangeText={setNombreBorrador} style={estilos.input} />
              <TextInput value={capacidadBorrador} onChangeText={setCapacidadBorrador} keyboardType="number-pad" style={estilos.input} />
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TouchableOpacity onPress={() => guardarEdicion(m.id)} style={[estilos.botonChico, { backgroundColor: colores.green }]}><Text style={{ color: "#fff", fontWeight: "700" }}>Guardar</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => setEditandoId(null)} style={[estilos.botonChico, { backgroundColor: colores.gray200 }]}><Text style={{ color: colores.texto }}>Cancelar</Text></TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <View style={estilos.filaEncabezado}>
                <Text style={estilos.nombre}>{m.nombre}</Text>
                <Text style={estilos.estado}>{ETIQUETA_ESTADO[m.estado] ?? m.estado}</Text>
              </View>
              <Text style={estilos.detalle}>{m.capacidad} personas</Text>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                <TouchableOpacity onPress={() => empezarEdicion(m)} style={[estilos.botonChico, { backgroundColor: colores.gray50 }]}><Text style={{ color: colores.texto }}>Editar</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => confirmarEliminar(m)} style={[estilos.botonChico, { backgroundColor: colores.red + "22" }]}><Text style={{ color: colores.red }}>Eliminar</Text></TouchableOpacity>
              </View>
            </>
          )}
        </View>
      ))}
      {mesas.length === 0 && <Text style={estilos.detalle}>Sin mesas todavía.</Text>}

      <View style={estilos.tarjeta}>
        <Text style={estilos.subtitulo}>Nueva mesa</Text>
        <TextInput placeholder="Nombre (ej. Mesa 9)" placeholderTextColor={colores.textoSecundario} value={nombreNueva} onChangeText={setNombreNueva} style={estilos.input} />
        <TextInput placeholder="Capacidad" placeholderTextColor={colores.textoSecundario} value={capacidadNueva} onChangeText={setCapacidadNueva} keyboardType="number-pad" style={estilos.input} />
        <TouchableOpacity onPress={crear} style={estilos.botonPrincipal}><Text style={estilos.botonPrincipalTexto}>Crear mesa</Text></TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    filaEncabezado: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    titulo: { fontSize: 22, fontWeight: "800", color: colores.texto, marginBottom: 10 },
    subtitulo: { fontSize: 16, fontWeight: "800", color: colores.texto, marginBottom: 8 },
    mensaje: { color: colores.navyTexto, marginBottom: 10 },
    chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: colores.gray50, borderWidth: 1, borderColor: colores.borde },
    chipActivo: { backgroundColor: colores.navy, borderColor: colores.navy },
    tarjeta: { backgroundColor: colores.superficie, borderRadius: 14, padding: 16, marginBottom: 12 },
    nombre: { fontSize: 16, fontWeight: "700", color: colores.texto },
    estado: { fontSize: 13, color: colores.textoSecundario },
    detalle: { fontSize: 13, color: colores.textoSecundario, marginTop: 2 },
    input: { borderWidth: 1, borderColor: colores.borde, borderRadius: 8, padding: 10, marginBottom: 8, color: colores.texto },
    botonChico: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
    botonPrincipal: { backgroundColor: colores.green, borderRadius: 10, padding: 14, alignItems: "center", marginTop: 4 },
    botonPrincipalTexto: { color: "#fff", fontWeight: "700" },
  });
}
