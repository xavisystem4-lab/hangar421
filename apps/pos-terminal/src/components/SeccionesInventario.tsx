import { useState } from "react";
import { Alert, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { usarColores } from "../store/temaStore";
import { abrirBaseDeDatos } from "../db/database";
import { guardarSeccion } from "../db/seccionesRepo";
import type { SeccionInventario } from "../inventario/secciones";

/** En qué sección está un insumo: se elige de la lista, o "Sin sección". */
export function ModalElegirSeccion({
  insumo,
  secciones,
  actual,
  onElegir,
  onCancelar,
}: {
  insumo: string;
  secciones: SeccionInventario[];
  actual: string | null;
  onElegir: (seccionId: string | null) => void;
  onCancelar: () => void;
}) {
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const opciones: { id: string | null; nombre: string }[] = [...secciones, { id: null, nombre: "Sin sección" }];

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onCancelar}>
      <View style={estilos.fondo}>
        <View style={estilos.hoja}>
          <View style={estilos.encabezado}>
            <Text style={estilos.titulo} numberOfLines={2}>¿Dónde está {insumo}?</Text>
            <TouchableOpacity onPress={onCancelar}><Text style={estilos.cerrar}>✕</Text></TouchableOpacity>
          </View>
          <ScrollView>
            {opciones.map((o) => {
              const elegida = o.id === actual;
              return (
                <TouchableOpacity key={o.id ?? "ninguna"} onPress={() => onElegir(o.id)} style={[estilos.opcion, elegida && estilos.opcionElegida]}>
                  <Text style={[estilos.opcionTexto, elegida && { color: "#fff" }]}>{o.id ? "📍 " : ""}{o.nombre}</Text>
                  {elegida && <Text style={{ color: "#fff", fontWeight: "800" }}>✓</Text>}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/** Agregar, renombrar y quitar secciones. Quitar una la da de baja: sus insumos quedan "Sin
 *  sección" hasta moverlos (no se pierde nada del inventario). */
export function ModalEditarSecciones({
  secciones,
  usuarioId,
  onCambio,
  onCerrar,
}: {
  secciones: SeccionInventario[];
  usuarioId?: string;
  onCambio: () => void | Promise<void>;
  onCerrar: () => void;
}) {
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const [nombres, setNombres] = useState<Record<string, string>>(() => Object.fromEntries(secciones.map((s) => [s.id, s.nombre])));
  const [nueva, setNueva] = useState("");

  async function guardar(datos: Parameters<typeof guardarSeccion>[1]) {
    try {
      await guardarSeccion(await abrirBaseDeDatos(), datos, usuarioId);
      await onCambio();
    } catch (e: any) {
      Alert.alert("Secciones", e?.message ?? "No se pudo guardar la sección.");
    }
  }

  function quitar(s: SeccionInventario) {
    Alert.alert("Quitar sección", `¿Quitar "${s.nombre}"? Sus insumos quedarán en "Sin sección" hasta que los muevas.`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Quitar", style: "destructive", onPress: () => guardar({ id: s.id, nombre: s.nombre, activo: false }) },
    ]);
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onCerrar}>
      <View style={estilos.fondo}>
        <View style={estilos.hoja}>
          <View style={estilos.encabezado}>
            <Text style={estilos.titulo}>Secciones del inventario</Text>
            <TouchableOpacity onPress={onCerrar}><Text style={estilos.cerrar}>✕</Text></TouchableOpacity>
          </View>
          <Text style={estilos.ayuda}>Las zonas donde se guardan los insumos en esta sucursal. Se suben al ERP; sin conexión se quedan aquí hasta sincronizar.</Text>
          <ScrollView keyboardShouldPersistTaps="handled">
            {secciones.map((s) => {
              const cambiado = (nombres[s.id] ?? s.nombre).trim() !== s.nombre;
              return (
                <View key={s.id} style={estilos.filaSeccion}>
                  <TextInput
                    value={nombres[s.id] ?? s.nombre}
                    onChangeText={(v) => setNombres((n) => ({ ...n, [s.id]: v }))}
                    style={[estilos.input, { flex: 1 }]}
                    maxLength={60}
                  />
                  {cambiado ? (
                    <TouchableOpacity onPress={() => guardar({ id: s.id, nombre: nombres[s.id] ?? s.nombre })} style={[estilos.boton, { backgroundColor: colores.green }]}>
                      <Text style={estilos.botonTexto}>Guardar</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity onPress={() => quitar(s)} style={[estilos.boton, { backgroundColor: colores.red + "22" }]}>
                      <Text style={[estilos.botonTexto, { color: colores.red }]}>Quitar</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
            <View style={[estilos.filaSeccion, { marginTop: 8 }]}>
              <TextInput
                value={nueva}
                onChangeText={setNueva}
                placeholder="Nueva sección (ej. Bodega)"
                placeholderTextColor={colores.textoSecundario}
                style={[estilos.input, { flex: 1 }]}
                maxLength={60}
              />
              <TouchableOpacity
                onPress={async () => { if (!nueva.trim()) return; await guardar({ nombre: nueva }); setNueva(""); }}
                disabled={!nueva.trim()}
                style={[estilos.boton, { backgroundColor: colores.navy }, !nueva.trim() && { opacity: 0.5 }]}
              >
                <Text style={estilos.botonTexto}>+ Agregar</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    fondo: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
    hoja: { backgroundColor: colores.fondo, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, maxHeight: "85%" },
    encabezado: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 10 },
    titulo: { fontSize: 18, fontWeight: "800", color: colores.texto, flex: 1 },
    cerrar: { color: colores.textoSecundario, fontSize: 20 },
    ayuda: { fontSize: 12, color: colores.textoSecundario, marginBottom: 10, lineHeight: 17 },
    opcion: {
      flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 15, minHeight: 52,
      borderRadius: 10, backgroundColor: colores.superficie, marginBottom: 8,
    },
    opcionElegida: { backgroundColor: colores.navy },
    opcionTexto: { fontSize: 15, fontWeight: "700", color: colores.texto },
    filaSeccion: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
    input: { borderWidth: 1, borderColor: colores.borde, borderRadius: 8, padding: 10, minHeight: 46, color: colores.texto, backgroundColor: colores.superficie },
    boton: { paddingHorizontal: 14, minHeight: 46, borderRadius: 8, justifyContent: "center" },
    botonTexto: { color: "#fff", fontWeight: "700", fontSize: 13 },
  });
}
