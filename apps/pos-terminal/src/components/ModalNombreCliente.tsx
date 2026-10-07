import { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { usarColores } from "../store/temaStore";
import { MAX_NOMBRE_CLIENTE, normalizarNombreCliente } from "../caja/nombreCliente";

/** Pregunta el nombre del pedido al iniciarlo: sale en el ticket y en la comanda para identificar
 *  a quién se le entrega. Es opcional — "Sin nombre" lo deja vacío y no se vuelve a preguntar en
 *  ese pedido (se puede poner después desde el carrito). */
export function ModalNombreCliente({
  inicial,
  onGuardar,
  onOmitir,
}: {
  inicial: string | null;
  onGuardar: (nombre: string) => void;
  onOmitir: () => void;
}) {
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const [texto, setTexto] = useState(inicial ?? "");
  const hayNombre = normalizarNombreCliente(texto) != null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onOmitir}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={estilos.fondo}>
        <View style={estilos.tarjeta}>
          <Text style={estilos.titulo}>¿Nombre para el pedido?</Text>
          <Text style={estilos.ayuda}>Saldrá en el ticket y en la comanda para saber a quién se le entrega.</Text>
          <TextInput
            value={texto}
            onChangeText={setTexto}
            placeholder="Ej. Ana"
            placeholderTextColor={colores.textoSecundario}
            autoFocus
            maxLength={MAX_NOMBRE_CLIENTE}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={() => (hayNombre ? onGuardar(texto) : onOmitir())}
            style={estilos.input}
            accessibilityLabel="Nombre del cliente"
          />
          <View style={estilos.botones}>
            <TouchableOpacity onPress={onOmitir} style={[estilos.boton, estilos.botonSecundario]} accessibilityLabel="Sin nombre">
              <Text style={estilos.textoSecundario}>{inicial ? "Quitar nombre" : "Sin nombre"}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onGuardar(texto)}
              disabled={!hayNombre}
              style={[estilos.boton, estilos.botonPrincipal, !hayNombre && { opacity: 0.5 }]}
              accessibilityLabel="Guardar nombre"
            >
              <Text style={estilos.textoPrincipal}>Guardar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    fondo: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 20 },
    tarjeta: { width: "100%", maxWidth: 420, backgroundColor: colores.superficie, borderRadius: 16, padding: 20 },
    titulo: { fontSize: 18, fontWeight: "800", color: colores.texto },
    ayuda: { fontSize: 13, color: colores.textoSecundario, marginTop: 4, marginBottom: 14 },
    input: { minHeight: 48, borderWidth: 1, borderColor: colores.borde, borderRadius: 10, paddingHorizontal: 12, fontSize: 18, color: colores.texto },
    botones: { flexDirection: "row", gap: 10, marginTop: 16 },
    boton: { flex: 1, minHeight: 48, borderRadius: 10, alignItems: "center", justifyContent: "center" },
    botonSecundario: { backgroundColor: colores.gray50 },
    botonPrincipal: { backgroundColor: colores.green },
    textoSecundario: { color: colores.texto, fontWeight: "700" },
    textoPrincipal: { color: "#fff", fontWeight: "700", fontSize: 16 },
  });
}
