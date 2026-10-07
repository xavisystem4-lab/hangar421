import { useMemo, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { usarColores } from "../store/temaStore";
import { filtrarEmpleadas, sucursalesDeEmpleadas, textoReinicio, type EmpleadaConCredito } from "../caja/creditoEmpleado";

const NARANJA = "#FF6A13";

/** Crédito de empleado: se busca a la empleada por nombre, se acota por sucursal y se elige. Cada
 *  una muestra lo que le queda del monedero (el mismo en todas las sucursales). */
export function ModalCreditoEmpleado({
  empleadas,
  seleccionadaId,
  onElegir,
  onQuitar,
  onCerrar,
}: {
  empleadas: EmpleadaConCredito[];
  seleccionadaId: string | null;
  onElegir: (empleada: EmpleadaConCredito) => void;
  onQuitar: () => void;
  onCerrar: () => void;
}) {
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const [texto, setTexto] = useState("");
  const [sucursalId, setSucursalId] = useState<string | null>(null);
  const sucursales = useMemo(() => sucursalesDeEmpleadas(empleadas), [empleadas]);
  const visibles = useMemo(() => filtrarEmpleadas(empleadas, texto, sucursalId), [empleadas, texto, sucursalId]);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCerrar}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={estilos.fondo}>
        <View style={estilos.tarjeta}>
          <Text style={estilos.titulo}>👛 Crédito de empleado</Text>
          <Text style={estilos.ayuda}>Busca a la empleada y elige su sucursal. El monedero es el mismo en todas las sucursales.</Text>

          <TextInput
            value={texto}
            onChangeText={setTexto}
            placeholder="Buscar nombre de la empleada"
            placeholderTextColor={colores.textoSecundario}
            autoCapitalize="words"
            autoCorrect={false}
            style={estilos.input}
            accessibilityLabel="Buscar empleada por nombre"
          />

          {sucursales.length > 0 && (
            <View style={estilos.chips}>
              {[{ id: null as string | null, nombre: "Todas" }, ...sucursales].map((s) => (
                <TouchableOpacity key={s.id ?? "todas"} onPress={() => setSucursalId(s.id)} style={[estilos.chip, sucursalId === s.id && estilos.chipActivo]} accessibilityLabel={`Sucursal ${s.nombre}`}>
                  <Text style={[estilos.chipTexto, sucursalId === s.id && { color: "#fff" }]}>{s.nombre}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <ScrollView style={{ maxHeight: 300 }} keyboardShouldPersistTaps="handled">
            {empleadas.length === 0 ? (
              <Text style={estilos.vacio}>No hay empleadas con crédito en esta tablet. Conéctala a internet para sincronizarlas.</Text>
            ) : visibles.length === 0 ? (
              <Text style={estilos.vacio}>Ninguna empleada coincide con la búsqueda.</Text>
            ) : (
              visibles.map((e) => {
                const sinSaldo = e.saldo <= 0;
                const activa = e.usuarioId === seleccionadaId;
                return (
                  <TouchableOpacity
                    key={e.usuarioId}
                    onPress={() => onElegir(e)}
                    disabled={sinSaldo}
                    style={[estilos.fila, activa && { borderColor: NARANJA, borderWidth: 2 }, sinSaldo && { opacity: 0.5 }]}
                    accessibilityLabel={`Elegir a ${e.nombre}`}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={estilos.nombre}>{e.nombre}{activa ? " ✓" : ""}</Text>
                      <Text style={estilos.detalle}>{e.sucursalNombre ?? "Sin sucursal"} · se renueva {textoReinicio(e.proximoReinicio)}</Text>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={[estilos.saldo, sinSaldo && { color: colores.red }]}>${e.saldo.toFixed(2)}</Text>
                      <Text style={estilos.detalle}>{sinSaldo ? "sin saldo" : `de $${e.limite.toFixed(0)}`}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </ScrollView>

          <View style={estilos.botones}>
            {seleccionadaId && (
              <TouchableOpacity onPress={onQuitar} style={[estilos.boton, estilos.botonSecundario]} accessibilityLabel="Quitar crédito de empleado">
                <Text style={[estilos.textoSecundario, { color: colores.red }]}>Quitar crédito</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={onCerrar} style={[estilos.boton, estilos.botonSecundario]} accessibilityLabel="Cerrar">
              <Text style={estilos.textoSecundario}>Cerrar</Text>
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
    tarjeta: { width: "100%", maxWidth: 480, backgroundColor: colores.superficie, borderRadius: 16, padding: 20 },
    titulo: { fontSize: 19, fontWeight: "800", color: colores.texto },
    ayuda: { fontSize: 13, color: colores.textoSecundario, marginTop: 4, marginBottom: 12 },
    input: { minHeight: 48, borderWidth: 1, borderColor: colores.borde, borderRadius: 10, paddingHorizontal: 12, fontSize: 17, color: colores.texto },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
    chip: { paddingHorizontal: 14, minHeight: 40, borderRadius: 20, borderWidth: 1, borderColor: colores.borde, alignItems: "center", justifyContent: "center", backgroundColor: colores.fondo },
    chipActivo: { backgroundColor: NARANJA, borderColor: NARANJA },
    chipTexto: { color: colores.texto, fontWeight: "700" },
    fila: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: colores.borde, borderRadius: 12, padding: 12, marginTop: 8, minHeight: 60, backgroundColor: colores.fondo },
    nombre: { fontSize: 16, fontWeight: "800", color: colores.texto },
    detalle: { fontSize: 12, color: colores.textoSecundario, marginTop: 2 },
    saldo: { fontSize: 18, fontWeight: "800", color: colores.green },
    vacio: { color: colores.textoSecundario, textAlign: "center", paddingVertical: 20 },
    botones: { flexDirection: "row", gap: 10, marginTop: 16 },
    boton: { flex: 1, minHeight: 48, borderRadius: 10, alignItems: "center", justifyContent: "center" },
    botonSecundario: { backgroundColor: colores.gray50 },
    textoSecundario: { color: colores.texto, fontWeight: "700" },
  });
}
