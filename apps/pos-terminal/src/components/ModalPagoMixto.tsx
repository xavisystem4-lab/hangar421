import { useMemo, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { usarColores } from "../store/temaStore";
import { armarPagosMixtos, type EntradaMixta } from "../caja/pagoMixto";

const NARANJA = "#FF6A13";

/**
 * Ventana flotante del pago MIXTO: un renglón por método de pago con su monto (efectivo una parte,
 * tarjeta o transferencia la otra…). "Resto" llena ese método con lo que falta. Solo deja usarlo
 * cuando lo capturado cubre la cuenta; el efectivo es el único que da cambio.
 */
export function ModalPagoMixto({
  total,
  metodos,
  tipoCambio,
  inicial,
  onUsar,
  onCerrar,
}: {
  total: number;
  metodos: { valor: string; etiqueta: string; icono: string }[];
  tipoCambio: number | null;
  inicial: EntradaMixta[] | null;
  onUsar: (entradas: EntradaMixta[]) => void;
  onCerrar: () => void;
}) {
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const [montos, setMontos] = useState<Record<string, string>>(() =>
    Object.fromEntries((inicial ?? []).map((e) => [e.metodo, String(e.cantidad)])),
  );
  const [referencias, setReferencias] = useState<Record<string, string>>(() =>
    Object.fromEntries((inicial ?? []).filter((e) => e.referencia).map((e) => [e.metodo, e.referencia as string])),
  );
  const entradas: EntradaMixta[] = useMemo(
    () => metodos.map((m) => ({ metodo: m.valor, cantidad: Number((montos[m.valor] ?? "").replace(",", ".")) || 0, referencia: referencias[m.valor]?.trim() || undefined })),
    [metodos, montos, referencias],
  );
  const r = armarPagosMixtos(total, entradas, tipoCambio);
  const usados = entradas.filter((e) => e.cantidad > 0).length;
  const listo = !r.error && r.faltante === 0 && usados >= 1;

  /** Llena este método con lo que falta (en dólares si es el renglón de dólares). */
  function resto(metodo: string) {
    const sinEste = armarPagosMixtos(total, entradas.map((e) => (e.metodo === metodo ? { ...e, cantidad: 0 } : e)), tipoCambio);
    const falta = sinEste.faltante;
    if (!(falta > 0)) return;
    const valor = metodo === "EFECTIVO_USD" ? (tipoCambio ? Math.ceil((falta / tipoCambio) * 100) / 100 : 0) : falta;
    setMontos((m) => ({ ...m, [metodo]: valor ? valor.toFixed(2) : "" }));
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCerrar}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={estilos.fondo}>
        <View style={estilos.tarjeta}>
          <Text style={estilos.titulo}>🔀 Pago mixto</Text>
          <Text style={estilos.ayuda}>Escribe cuánto paga con cada método. Total a cubrir: <Text style={{ fontWeight: "800", color: colores.texto }}>${total.toFixed(2)}</Text></Text>
          <ScrollView style={{ maxHeight: 380 }} keyboardShouldPersistTaps="handled">
            {metodos.map((m) => {
              const esUsd = m.valor === "EFECTIVO_USD";
              const sinCambio = m.valor !== "EFECTIVO" && !esUsd;
              const valor = montos[m.valor] ?? "";
              return (
                <View key={m.valor} style={[estilos.fila, Number(valor) > 0 && { borderColor: NARANJA, borderWidth: 2 }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={estilos.metodo}>{m.icono} {m.etiqueta}</Text>
                    <TextInput
                      value={valor}
                      onChangeText={(t) => setMontos((s) => ({ ...s, [m.valor]: t.replace(/[^0-9.,]/g, "") }))}
                      placeholder={esUsd ? "US$0" : "$0"}
                      placeholderTextColor={colores.textoSecundario}
                      keyboardType="decimal-pad"
                      style={estilos.input}
                      accessibilityLabel={`Monto con ${m.etiqueta}`}
                    />
                    <TouchableOpacity onPress={() => resto(m.valor)} style={estilos.botonResto} accessibilityLabel={`Poner el resto en ${m.etiqueta}`}>
                      <Text style={estilos.botonRestoTexto}>Resto</Text>
                    </TouchableOpacity>
                  </View>
                  {esUsd && tipoCambio ? <Text style={estilos.nota}>US$1 = ${tipoCambio.toFixed(2)}{Number(valor) > 0 ? ` · = $${(Number(valor) * tipoCambio).toFixed(2)}` : ""}</Text> : null}
                  {sinCambio && Number(valor) > 0 && (
                    <TextInput
                      value={referencias[m.valor] ?? ""}
                      onChangeText={(t) => setReferencias((s) => ({ ...s, [m.valor]: t }))}
                      placeholder="Referencia / autorización (opcional)"
                      placeholderTextColor={colores.textoSecundario}
                      maxLength={40}
                      style={[estilos.input, { marginTop: 6, flex: 0 }]}
                    />
                  )}
                </View>
              );
            })}
          </ScrollView>

          <View style={estilos.resumen}>
            {r.error ? (
              <Text style={{ color: colores.red, fontWeight: "700" }}>{r.error}</Text>
            ) : r.faltante > 0 ? (
              <Text style={{ color: colores.red, fontWeight: "800", fontSize: 18 }}>Falta cubrir: ${r.faltante.toFixed(2)}</Text>
            ) : (
              <Text style={{ color: colores.green, fontWeight: "800", fontSize: 18 }}>Cubierto ✓{r.cambio > 0 ? ` · Cambio: $${r.cambio.toFixed(2)}` : ""}</Text>
            )}
          </View>

          <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
            <TouchableOpacity onPress={onCerrar} style={[estilos.boton, { backgroundColor: colores.gray50 }]}>
              <Text style={{ color: colores.texto, fontWeight: "700" }}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onUsar(entradas.filter((e) => e.cantidad > 0))}
              disabled={!listo}
              style={[estilos.boton, { flex: 2, backgroundColor: listo ? colores.green : colores.gray200 }]}
            >
              <Text style={{ color: listo ? "#fff" : colores.texto, fontWeight: "800" }}>Usar estos pagos</Text>
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
    tarjeta: { width: "100%", maxWidth: 520, backgroundColor: colores.superficie, borderRadius: 16, padding: 20 },
    titulo: { fontSize: 20, fontWeight: "800", color: colores.texto },
    ayuda: { fontSize: 13, color: colores.textoSecundario, marginTop: 4, marginBottom: 10 },
    fila: { borderWidth: 1, borderColor: colores.borde, borderRadius: 12, padding: 10, marginTop: 8, backgroundColor: colores.fondo },
    metodo: { width: 150, fontSize: 15, fontWeight: "800", color: colores.texto },
    input: { flex: 1, minHeight: 46, borderWidth: 1, borderColor: colores.borde, borderRadius: 10, paddingHorizontal: 12, fontSize: 18, color: colores.texto, backgroundColor: colores.superficie },
    botonResto: { paddingHorizontal: 12, minHeight: 46, borderRadius: 10, backgroundColor: colores.navy, alignItems: "center", justifyContent: "center" },
    botonRestoTexto: { color: "#fff", fontWeight: "800" },
    nota: { fontSize: 12, color: colores.textoSecundario, marginTop: 4 },
    resumen: { marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: colores.borde },
    boton: { flex: 1, minHeight: 50, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  });
}
