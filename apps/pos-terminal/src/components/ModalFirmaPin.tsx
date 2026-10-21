import { useState } from "react";
import { ActivityIndicator, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { usarColores } from "../store/temaStore";
import { abrirBaseDeDatos } from "../db/database";
import { validarPinLocal } from "../db/usuariosLocalesRepo";

/**
 * Firma con PIN PERSONAL: la persona indicada (la cajera que entrega su corte, la que abre el
 * siguiente turno) escribe SU PIN para dejar constancia. A diferencia de ModalAutorizacion no se
 * elige a nadie: firma quien debe firmar. Valida sin red contra el hash local.
 */
export function ModalFirmaPin({
  titulo,
  descripcion,
  usuarioId,
  nombre,
  onCancelar,
  onFirmado,
}: {
  titulo: string;
  descripcion: string;
  usuarioId: string;
  nombre: string;
  onCancelar: () => void;
  onFirmado: () => void;
}) {
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [validando, setValidando] = useState(false);

  async function firmar() {
    if (pin.length < 4 || validando) return;
    setValidando(true);
    setError(null);
    try {
      const ok = await validarPinLocal(await abrirBaseDeDatos(), usuarioId, pin);
      if (!ok) {
        setError("PIN incorrecto.");
        setPin("");
        return;
      }
      onFirmado();
    } finally {
      setValidando(false);
    }
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onCancelar}>
      <View style={estilos.fondo}>
        <View style={estilos.hoja}>
          <View style={estilos.encabezado}>
            <Text style={estilos.titulo}>✍️ {titulo}</Text>
            <TouchableOpacity onPress={onCancelar}><Text style={estilos.cerrar}>✕</Text></TouchableOpacity>
          </View>
          <Text style={estilos.ayuda}>{descripcion}</Text>
          <Text style={estilos.nombre}>{nombre}</Text>
          <TextInput
            value={pin}
            onChangeText={(v) => { setPin(v.replace(/[^0-9]/g, "").slice(0, 6)); setError(null); }}
            keyboardType="number-pad"
            secureTextEntry
            autoFocus
            onSubmitEditing={firmar}
            placeholder="Tu PIN"
            placeholderTextColor={colores.textoSecundario}
            style={estilos.inputPin}
            accessibilityLabel={`PIN de ${nombre}`}
          />
          {error && <Text style={estilos.error}>{error}</Text>}
          <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
            <TouchableOpacity onPress={onCancelar} style={estilos.botonCancelar}>
              <Text style={estilos.botonCancelarTexto}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={firmar} disabled={pin.length < 4 || validando} style={[estilos.botonConfirmar, (pin.length < 4 || validando) && { opacity: 0.5 }]}>
              {validando ? <ActivityIndicator color="#fff" /> : <Text style={estilos.botonConfirmarTexto}>Firmar</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    fondo: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
    hoja: { backgroundColor: colores.fondo, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18 },
    encabezado: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    titulo: { fontSize: 18, fontWeight: "800", color: colores.texto, flex: 1 },
    cerrar: { color: colores.textoSecundario, fontSize: 22, paddingHorizontal: 8 },
    ayuda: { fontSize: 13, color: colores.textoSecundario, marginTop: 6, marginBottom: 10, lineHeight: 18 },
    nombre: { fontSize: 16, fontWeight: "800", color: colores.navy, marginBottom: 8 },
    inputPin: {
      borderWidth: 1, borderColor: colores.borde, borderRadius: 10, paddingVertical: 14,
      fontSize: 24, letterSpacing: 8, textAlign: "center", color: colores.texto,
    },
    error: { color: colores.red, fontSize: 13, marginTop: 10 },
    botonCancelar: { flex: 1, padding: 15, borderRadius: 10, backgroundColor: colores.gray50, alignItems: "center", minHeight: 50, justifyContent: "center" },
    botonCancelarTexto: { fontWeight: "700", color: colores.texto },
    botonConfirmar: { flex: 2, padding: 15, borderRadius: 10, backgroundColor: colores.navy, alignItems: "center", minHeight: 50, justifyContent: "center" },
    botonConfirmarTexto: { color: "#fff", fontWeight: "800", fontSize: 15 },
  });
}
