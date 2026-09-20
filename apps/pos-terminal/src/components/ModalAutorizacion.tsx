import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { usarColores } from "../store/temaStore";
import { abrirBaseDeDatos } from "../db/database";
import { autorizarConPin, listarAutorizadores, type Autorizador } from "../auth/autorizacion";

const ETIQUETA_ROL: Record<string, string> = {
  SUPERVISOR: "Supervisor",
  ADMIN_SUCURSAL: "Administrador de sucursal",
  ADMIN_CORPORATIVO: "Administrador corporativo",
};

/** Pide el PIN de un gerente antes de una acción sensible (cancelar un ticket, reabrir una
 *  cuenta, cerrar un conteo). Funciona sin red: valida contra el hash local, igual que el login
 *  por PIN — una cancelación tiene que poder hacerse con la tienda sin internet. */
export function ModalAutorizacion({
  titulo,
  descripcion,
  solicitanteId,
  onCancelar,
  onAutorizado,
}: {
  titulo: string;
  descripcion: string;
  solicitanteId: string;
  onCancelar: () => void;
  onAutorizado: (autorizador: Autorizador) => void;
}) {
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const [autorizadores, setAutorizadores] = useState<Autorizador[] | null>(null);
  const [elegido, setElegido] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [validando, setValidando] = useState(false);

  useEffect(() => {
    abrirBaseDeDatos().then(listarAutorizadores).then((lista) => {
      setAutorizadores(lista);
      if (lista.length === 1) setElegido(lista[0].id);
    });
  }, []);

  async function confirmar() {
    if (!elegido || pin.length < 4 || validando) return;
    setValidando(true);
    setError(null);
    try {
      const db = await abrirBaseDeDatos();
      const r = await autorizarConPin(db, { autorizadorId: elegido, pin, solicitanteId });
      if (!r.autorizado || !r.autorizador) {
        setError(r.error ?? "No autorizado.");
        setPin("");
        return;
      }
      onAutorizado(r.autorizador);
    } finally {
      setValidando(false);
    }
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onCancelar}>
      <View style={estilos.fondo}>
        <View style={estilos.hoja}>
          <View style={estilos.encabezado}>
            <Text style={estilos.titulo}>{titulo}</Text>
            <TouchableOpacity onPress={onCancelar}><Text style={estilos.cerrar}>✕</Text></TouchableOpacity>
          </View>
          <Text style={estilos.ayuda}>{descripcion}</Text>

          {autorizadores === null ? (
            <ActivityIndicator color={colores.navy} style={{ marginVertical: 20 }} />
          ) : autorizadores.length === 0 ? (
            // Sin gerentes dados de alta en la terminal no hay forma de autorizar nada offline.
            // Se dice qué hacer en vez de dejar un modal vacío.
            <Text style={estilos.error}>
              No hay ningún supervisor o administrador con PIN en esta terminal. Da de alta uno
              desde Admin → Usuarios antes de poder autorizar esta acción.
            </Text>
          ) : (
            <>
              <Text style={estilos.etiqueta}>¿Quién autoriza?</Text>
              <ScrollView style={{ maxHeight: 190 }}>
                {autorizadores.map((a) => (
                  <TouchableOpacity
                    key={a.id}
                    onPress={() => { setElegido(a.id); setError(null); }}
                    style={[estilos.fila, elegido === a.id && estilos.filaActiva]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[estilos.nombre, elegido === a.id && { color: "#fff" }]}>{a.nombre}</Text>
                      <Text style={[estilos.rol, elegido === a.id && { color: "rgba(255,255,255,0.8)" }]}>
                        {ETIQUETA_ROL[a.rol] ?? a.rol}
                        {a.id === solicitanteId ? " · eres tú" : ""}
                      </Text>
                    </View>
                    {elegido === a.id && <Text style={{ color: "#fff", fontSize: 18 }}>✓</Text>}
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={estilos.etiqueta}>PIN</Text>
              <TextInput
                value={pin}
                onChangeText={(v) => { setPin(v.replace(/[^0-9]/g, "").slice(0, 6)); setError(null); }}
                keyboardType="number-pad"
                secureTextEntry
                placeholder="••••"
                placeholderTextColor={colores.textoSecundario}
                style={estilos.inputPin}
                accessibilityLabel="PIN de autorización"
              />

              {error && <Text style={estilos.error}>{error}</Text>}

              <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
                <TouchableOpacity onPress={onCancelar} style={estilos.botonCancelar}>
                  <Text style={estilos.botonCancelarTexto}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={confirmar}
                  disabled={!elegido || pin.length < 4 || validando}
                  style={[estilos.botonConfirmar, (!elegido || pin.length < 4 || validando) && { opacity: 0.5 }]}
                >
                  {validando ? <ActivityIndicator color="#fff" /> : <Text style={estilos.botonConfirmarTexto}>Autorizar</Text>}
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    fondo: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
    hoja: { backgroundColor: colores.fondo, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, maxHeight: "88%" },
    encabezado: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    titulo: { fontSize: 18, fontWeight: "800", color: colores.texto, flex: 1 },
    cerrar: { color: colores.textoSecundario, fontSize: 22, paddingHorizontal: 8 },
    ayuda: { fontSize: 13, color: colores.textoSecundario, marginTop: 6, marginBottom: 12, lineHeight: 18 },
    etiqueta: { fontSize: 11, color: colores.textoSecundario, fontWeight: "700", textTransform: "uppercase", marginTop: 10, marginBottom: 6 },
    fila: {
      flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 10, marginBottom: 6,
      backgroundColor: colores.superficie, borderWidth: 1, borderColor: colores.borde, minHeight: 56,
    },
    filaActiva: { backgroundColor: colores.navy, borderColor: colores.navy },
    nombre: { fontSize: 15, fontWeight: "700", color: colores.texto },
    rol: { fontSize: 12, color: colores.textoSecundario },
    inputPin: {
      borderWidth: 1, borderColor: colores.borde, borderRadius: 10, paddingVertical: 14,
      fontSize: 24, letterSpacing: 8, textAlign: "center", color: colores.texto,
    },
    error: { color: colores.red, fontSize: 13, marginTop: 10, lineHeight: 18 },
    botonCancelar: { flex: 1, padding: 15, borderRadius: 10, backgroundColor: colores.gray50, alignItems: "center", minHeight: 50, justifyContent: "center" },
    botonCancelarTexto: { fontWeight: "700", color: colores.texto },
    botonConfirmar: { flex: 2, padding: 15, borderRadius: 10, backgroundColor: colores.navy, alignItems: "center", minHeight: 50, justifyContent: "center" },
    botonConfirmarTexto: { color: "#fff", fontWeight: "800", fontSize: 15 },
  });
}
