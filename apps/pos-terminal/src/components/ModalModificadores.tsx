import { useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { usarColores } from "../store/temaStore";
import type { ModificadorLocal, ProductoLocal } from "../db/catalogoRepo";
import type { SeleccionModificador } from "../store/carritoStore";

/** Modal de producto compuesto — el equivalente táctil del ModalModificadores del POS Windows:
 *  al tocar un café pregunta tamaño, tipo de leche, jarabes y cold foam antes de agregarlo.
 *
 *  Misma regla de preselección que en Windows: cada modificador de selección única y obligatorio
 *  arranca con su primera opción ya elegida (Chico, Entera), así el cajero puede confirmar sin
 *  tocar nada si el cliente no pide cambios — que es el caso más común en barra. */
export function ModalModificadores({
  producto,
  modificadores,
  onCancelar,
  onConfirmar,
}: {
  producto: ProductoLocal;
  modificadores: ModificadorLocal[];
  onCancelar: () => void;
  onConfirmar: (cantidad: number, seleccion: SeleccionModificador[], notas: string) => void;
}) {
  const colores = usarColores();
  const estilos = crearEstilos(colores);

  const [cantidad, setCantidad] = useState(1);
  const [notas, setNotas] = useState("");
  const [seleccionUnica, setSeleccionUnica] = useState<Record<string, SeleccionModificador>>(() => {
    const inicial: Record<string, SeleccionModificador> = {};
    for (const mod of modificadores) {
      if (mod.tipo === "SELECCION_UNICA" && mod.obligatorio && mod.opciones.length > 0) {
        const primera = [...mod.opciones].sort((a, b) => a.orden - b.orden)[0];
        inicial[mod.id] = { opcionModificadorId: primera.id, nombreOpcion: primera.nombre, precioExtra: primera.precioExtra };
      }
    }
    return inicial;
  });
  const [seleccionMultiple, setSeleccionMultiple] = useState<Record<string, SeleccionModificador>>({});

  const seleccion = [...Object.values(seleccionUnica), ...Object.values(seleccionMultiple)];
  const precioExtra = seleccion.reduce((s, o) => s + o.precioExtra, 0);
  const total = (producto.precioBase + precioExtra) * cantidad;

  // Defensivo: con la preselección de arriba no debería faltar ninguno, salvo que un modificador
  // obligatorio llegue del ERP sin opciones.
  const faltanObligatorios = modificadores.some((m) => m.tipo === "SELECCION_UNICA" && m.obligatorio && !seleccionUnica[m.id]);

  function alternar(mod: ModificadorLocal, opcion: ModificadorLocal["opciones"][number]) {
    const valor: SeleccionModificador = {
      opcionModificadorId: opcion.id,
      nombreOpcion: opcion.nombre,
      precioExtra: opcion.precioExtra,
    };
    if (mod.tipo === "MULTIPLE") {
      setSeleccionMultiple((s) => {
        const copia = { ...s };
        if (copia[opcion.id]) delete copia[opcion.id];
        else copia[opcion.id] = valor;
        return copia;
      });
    } else {
      setSeleccionUnica((s) => ({ ...s, [mod.id]: valor }));
    }
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onCancelar}>
      <View style={estilos.fondo}>
        <View style={estilos.hoja}>
          <View style={estilos.encabezado}>
            <Text style={estilos.titulo} numberOfLines={1}>{producto.nombre}</Text>
            <TouchableOpacity onPress={onCancelar} accessibilityLabel="Cancelar">
              <Text style={estilos.cerrar}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
            {modificadores.map((mod) => (
              <View key={mod.id} style={{ marginTop: 14 }}>
                <Text style={estilos.nombreModificador}>
                  {mod.nombre}{mod.obligatorio ? " *" : ""}
                  {mod.tipo === "MULTIPLE" ? <Text style={estilos.pista}>  (puedes elegir varios)</Text> : null}
                </Text>
                <View style={estilos.opciones}>
                  {mod.opciones.map((op) => {
                    const activa = mod.tipo === "MULTIPLE"
                      ? !!seleccionMultiple[op.id]
                      : seleccionUnica[mod.id]?.opcionModificadorId === op.id;
                    return (
                      <TouchableOpacity
                        key={op.id}
                        onPress={() => alternar(mod, op)}
                        style={[estilos.opcion, activa && estilos.opcionActiva]}
                        accessibilityLabel={`${mod.nombre}: ${op.nombre}`}
                      >
                        <Text style={[estilos.opcionTexto, activa && estilos.opcionTextoActivo]}>
                          {op.nombre}{op.precioExtra > 0 ? ` (+$${op.precioExtra})` : ""}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ))}

            <View style={{ marginTop: 16 }}>
              <Text style={estilos.nombreModificador}>Nota</Text>
              <TextInput
                value={notas}
                onChangeText={setNotas}
                placeholder="Ej. sin hielo, alergia a nuez…"
                placeholderTextColor={colores.textoSecundario}
                style={estilos.input}
              />
            </View>

            {seleccion.length > 0 && (
              <View style={estilos.resumen}>
                <Text style={estilos.resumenTexto}>
                  {seleccion.map((s) => s.nombreOpcion + (s.precioExtra > 0 ? ` (+$${s.precioExtra})` : "")).join(" · ")}
                </Text>
              </View>
            )}
          </ScrollView>

          <View style={estilos.filaCantidad}>
            <TouchableOpacity onPress={() => setCantidad((c) => Math.max(1, c - 1))} style={estilos.botonCantidad} accessibilityLabel="Quitar uno">
              <Text style={estilos.botonCantidadTexto}>−</Text>
            </TouchableOpacity>
            <Text style={estilos.cantidad}>{cantidad}</Text>
            <TouchableOpacity onPress={() => setCantidad((c) => c + 1)} style={estilos.botonCantidad} accessibilityLabel="Agregar uno">
              <Text style={estilos.botonCantidadTexto}>+</Text>
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
            <TouchableOpacity onPress={onCancelar} style={estilos.botonCancelar}>
              <Text style={estilos.botonCancelarTexto}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onConfirmar(cantidad, seleccion, notas.trim())}
              disabled={faltanObligatorios}
              style={[estilos.botonAgregar, faltanObligatorios && { opacity: 0.5 }]}
            >
              <Text style={estilos.botonAgregarTexto}>Agregar — ${total.toFixed(2)}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    fondo: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
    // Hoja inferior, no diálogo centrado: en una tablet de barra el pulgar llega abajo, y así
    // el teclado de la nota no tapa los botones.
    hoja: { backgroundColor: colores.fondo, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, maxHeight: "88%" },
    encabezado: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    titulo: { fontSize: 19, fontWeight: "800", color: colores.texto, flex: 1 },
    cerrar: { color: colores.textoSecundario, fontSize: 22, paddingHorizontal: 8 },
    nombreModificador: { fontSize: 13, fontWeight: "800", color: colores.texto },
    pista: { fontSize: 11, fontWeight: "600", color: colores.textoSecundario },
    opciones: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
    opcion: {
      paddingHorizontal: 16, paddingVertical: 12, borderRadius: 10, minHeight: 46, justifyContent: "center",
      backgroundColor: colores.gray50, borderWidth: 1, borderColor: colores.borde,
    },
    opcionActiva: { backgroundColor: colores.navy, borderColor: colores.navy },
    opcionTexto: { fontSize: 14, fontWeight: "600", color: colores.texto },
    opcionTextoActivo: { color: "#fff" },
    input: { borderWidth: 1, borderColor: colores.borde, borderRadius: 10, padding: 12, marginTop: 8, fontSize: 15, color: colores.texto },
    resumen: { marginTop: 14, padding: 12, borderRadius: 10, backgroundColor: colores.gray50 },
    resumenTexto: { fontSize: 13, color: colores.texto },
    filaCantidad: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 14 },
    botonCantidad: { width: 48, height: 48, borderRadius: 10, backgroundColor: colores.gray50, alignItems: "center", justifyContent: "center" },
    botonCantidadTexto: { fontSize: 22, fontWeight: "700", color: colores.texto },
    cantidad: { fontSize: 19, fontWeight: "800", color: colores.texto, minWidth: 28, textAlign: "center" },
    botonCancelar: { flex: 1, padding: 16, borderRadius: 12, backgroundColor: colores.gray50, alignItems: "center", minHeight: 52, justifyContent: "center" },
    botonCancelarTexto: { fontWeight: "700", color: colores.texto },
    botonAgregar: { flex: 2, padding: 16, borderRadius: 12, backgroundColor: colores.green, alignItems: "center", minHeight: 52, justifyContent: "center" },
    botonAgregarTexto: { color: "#fff", fontWeight: "700", fontSize: 16 },
  });
}
