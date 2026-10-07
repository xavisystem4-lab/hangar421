import { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { usarColores } from "../store/temaStore";
import { validarNuevoModificador, type ModificadorNuevo, type TipoModificador } from "../caja/nuevoModificador";

/** Crear un grupo de modificadores desde el alta de producto (Tamaño, Tipo de leche, Extras,
 *  Jarabe…): nombre, si se elige una opción o varias, si es obligatorio y sus opciones con precio
 *  extra. Solo recoge y valida; guardar y sincronizar lo hace quien lo abre (onCrear). */
export function ModalNuevoModificador({
  nombresExistentes,
  onCrear,
  onCancelar,
}: {
  nombresExistentes: string[];
  onCrear: (modificador: ModificadorNuevo) => Promise<void> | void;
  onCancelar: () => void;
}) {
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState<TipoModificador>("SELECCION_UNICA");
  const [obligatorio, setObligatorio] = useState(false);
  const [opciones, setOpciones] = useState([{ nombre: "", precio: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  function cambiarOpcion(i: number, campo: "nombre" | "precio", valor: string) {
    setOpciones((o) => o.map((x, j) => (j === i ? { ...x, [campo]: valor } : x)));
  }

  async function crear() {
    const r = validarNuevoModificador({ nombre, tipo, obligatorio, opciones }, nombresExistentes);
    if (!r.ok) { setError(r.error); return; }
    setGuardando(true);
    try {
      await onCrear(r.valor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar el modificador.");
      setGuardando(false);
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancelar}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={estilos.fondo}>
        <View style={estilos.tarjeta}>
          <Text style={estilos.titulo}>Nuevo modificador</Text>
          <Text style={estilos.ayuda}>Por ejemplo: "Tipo de leche" con Entera, Avena +$10, Almendra +$10.</Text>

          <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
            <TextInput
              placeholder="Nombre (Tamaño, Tipo de leche, Extras…)"
              placeholderTextColor={colores.textoSecundario}
              value={nombre}
              onChangeText={(v) => { setNombre(v); setError(null); }}
              style={estilos.input}
              accessibilityLabel="Nombre del modificador"
            />

            <View style={estilos.fila}>
              {([["SELECCION_UNICA", "Elegir una"], ["MULTIPLE", "Elegir varias"]] as const).map(([valor, texto]) => (
                <TouchableOpacity key={valor} onPress={() => setTipo(valor)} style={[estilos.chip, tipo === valor && estilos.chipActivo]} accessibilityLabel={texto}>
                  <Text style={{ color: tipo === valor ? "#fff" : colores.texto, fontWeight: "700" }}>{texto}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity onPress={() => setObligatorio((o) => !o)} style={[estilos.chip, estilos.chipAncho, obligatorio && estilos.chipActivo]} accessibilityLabel="Obligatorio">
              <Text style={{ color: obligatorio ? "#fff" : colores.texto, fontWeight: "700" }}>{obligatorio ? "✓ Obligatorio" : "Obligatorio (el cajero debe elegir)"}</Text>
            </TouchableOpacity>

            <Text style={estilos.subtitulo}>Opciones</Text>
            {opciones.map((o, i) => (
              <View key={i} style={estilos.fila}>
                <TextInput
                  placeholder="Opción"
                  placeholderTextColor={colores.textoSecundario}
                  value={o.nombre}
                  onChangeText={(v) => { cambiarOpcion(i, "nombre", v); setError(null); }}
                  style={[estilos.input, { flex: 1, marginBottom: 0 }]}
                  accessibilityLabel={`Opción ${i + 1}`}
                />
                <TextInput
                  placeholder="+$0"
                  placeholderTextColor={colores.textoSecundario}
                  value={o.precio}
                  onChangeText={(v) => { cambiarOpcion(i, "precio", v); setError(null); }}
                  keyboardType="decimal-pad"
                  style={[estilos.input, { width: 80, marginBottom: 0 }]}
                  accessibilityLabel={`Precio extra de la opción ${i + 1}`}
                />
                {opciones.length > 1 && (
                  <TouchableOpacity onPress={() => setOpciones((x) => x.filter((_, j) => j !== i))} style={estilos.quitar} accessibilityLabel={`Quitar opción ${i + 1}`}>
                    <Text style={{ color: colores.red, fontWeight: "800" }}>✕</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
            <TouchableOpacity onPress={() => setOpciones((x) => [...x, { nombre: "", precio: "" }])} style={estilos.agregar} accessibilityLabel="Agregar otra opción">
              <Text style={{ color: colores.navyTexto, fontWeight: "700" }}>+ Agregar otra opción</Text>
            </TouchableOpacity>
          </ScrollView>

          {error && <Text style={estilos.error}>{error}</Text>}

          <View style={estilos.botones}>
            <TouchableOpacity onPress={onCancelar} style={[estilos.boton, { backgroundColor: colores.gray50 }]}>
              <Text style={{ color: colores.texto, fontWeight: "700" }}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={crear} disabled={guardando} style={[estilos.boton, { backgroundColor: colores.green, opacity: guardando ? 0.6 : 1 }]} accessibilityLabel="Crear modificador">
              <Text style={{ color: "#fff", fontWeight: "700" }}>Crear modificador</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    fondo: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 16 },
    tarjeta: { width: "100%", maxWidth: 560, backgroundColor: colores.superficie, borderRadius: 16, padding: 18 },
    titulo: { fontSize: 18, fontWeight: "800", color: colores.texto },
    ayuda: { fontSize: 13, color: colores.textoSecundario, marginTop: 4, marginBottom: 12, lineHeight: 18 },
    subtitulo: { fontSize: 14, fontWeight: "800", color: colores.texto, marginTop: 14, marginBottom: 8 },
    input: { borderWidth: 1, borderColor: colores.borde, borderRadius: 8, padding: 10, marginBottom: 10, color: colores.texto, minHeight: 44 },
    fila: { flexDirection: "row", gap: 8, alignItems: "center", marginBottom: 8 },
    chip: { flex: 1, minHeight: 44, borderRadius: 8, borderWidth: 1, borderColor: colores.borde, backgroundColor: colores.gray50, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
    chipAncho: { flex: 0, alignSelf: "stretch" },
    chipActivo: { backgroundColor: colores.navy, borderColor: colores.navy },
    quitar: { width: 36, minHeight: 44, alignItems: "center", justifyContent: "center" },
    agregar: { minHeight: 44, justifyContent: "center" },
    error: { color: colores.red, fontSize: 13, marginTop: 8 },
    botones: { flexDirection: "row", gap: 10, marginTop: 12 },
    boton: { flex: 1, minHeight: 48, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  });
}
