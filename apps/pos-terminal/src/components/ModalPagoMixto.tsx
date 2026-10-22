import { useMemo, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { usarColores } from "../store/temaStore";
import { armarPagosMixtos, type EntradaMixta } from "../caja/pagoMixto";

const NARANJA = "#FF6A13";

/**
 * Ventana flotante del pago MIXTO: una tarjeta por método de pago con su monto (efectivo una
 * parte, tarjeta o transferencia la otra…). "Resto" llena ese método con lo que falta. La barra
 * de arriba enseña cuánto va cubierto; solo deja usarlo cuando lo capturado cubre la cuenta. El
 * efectivo es el único que da cambio.
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
  const e = crearEstilos(colores);
  const [montos, setMontos] = useState<Record<string, string>>(() =>
    Object.fromEntries((inicial ?? []).map((x) => [x.metodo, String(x.cantidad)])),
  );
  const [referencias, setReferencias] = useState<Record<string, string>>(() =>
    Object.fromEntries((inicial ?? []).filter((x) => x.referencia).map((x) => [x.metodo, x.referencia as string])),
  );
  const entradas: EntradaMixta[] = useMemo(
    () => metodos.map((m) => ({ metodo: m.valor, cantidad: Number((montos[m.valor] ?? "").replace(",", ".")) || 0, referencia: referencias[m.valor]?.trim() || undefined })),
    [metodos, montos, referencias],
  );
  const r = armarPagosMixtos(total, entradas, tipoCambio);
  const usados = entradas.filter((x) => x.cantidad > 0).length;
  const listo = !r.error && r.faltante === 0 && usados >= 1;
  const cubierto = Math.max(0, total - r.faltante);
  const avance = total > 0 ? Math.min(1, cubierto / total) : 1;

  /** Llena este método con lo que falta (en dólares si es el renglón de dólares). */
  function resto(metodo: string) {
    const sinEste = armarPagosMixtos(total, entradas.map((x) => (x.metodo === metodo ? { ...x, cantidad: 0 } : x)), tipoCambio);
    const falta = sinEste.faltante;
    if (!(falta > 0)) return;
    const valor = metodo === "EFECTIVO_USD" ? (tipoCambio ? Math.ceil((falta / tipoCambio) * 100) / 100 : 0) : falta;
    setMontos((m) => ({ ...m, [metodo]: valor ? valor.toFixed(2) : "" }));
  }

  function limpiar() {
    setMontos({});
    setReferencias({});
  }

  const colorEstado = r.error ? colores.red : r.faltante > 0 ? colores.red : colores.green;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCerrar}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={e.fondo}>
        <View style={e.tarjeta}>
          {/* Encabezado */}
          <View style={e.encabezado}>
            <View style={{ flex: 1 }}>
              <Text style={e.titulo}>🔀 Pago mixto</Text>
              <Text style={e.subtitulo}>Reparte la cuenta entre varios métodos de pago</Text>
            </View>
            <TouchableOpacity onPress={onCerrar} accessibilityLabel="Cerrar"><Text style={e.cerrar}>✕</Text></TouchableOpacity>
          </View>

          {/* Total y avance */}
          <View style={e.cajaTotal}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
              <Text style={e.etiquetaTotal}>Total a cobrar</Text>
              <Text style={e.total}>${total.toFixed(2)}</Text>
            </View>
            <View style={e.barra}>
              <View style={[e.barraRelleno, { width: `${avance * 100}%`, backgroundColor: listo ? colores.green : NARANJA }]} />
            </View>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
              <Text style={e.detalle}>Cubierto: ${cubierto.toFixed(2)}</Text>
              <Text style={[e.detalle, { color: colorEstado, fontWeight: "800" }]}>
                {r.error ? "Revisa los montos" : r.faltante > 0 ? `Falta $${r.faltante.toFixed(2)}` : r.cambio > 0 ? `Cambio $${r.cambio.toFixed(2)}` : "✓ Completo"}
              </Text>
            </View>
          </View>

          {/* Un renglón por método */}
          <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 6 }} keyboardShouldPersistTaps="handled">
            {metodos.map((m) => {
              const esUsd = m.valor === "EFECTIVO_USD";
              const daCambio = m.valor === "EFECTIVO" || esUsd;
              const valor = montos[m.valor] ?? "";
              const activo = Number(valor.replace(",", ".")) > 0;
              return (
                <View key={m.valor} style={[e.metodo, activo && e.metodoActivo]}>
                  <View style={e.filaMetodo}>
                    <View style={[e.icono, activo && { backgroundColor: NARANJA }]}><Text style={{ fontSize: 22 }}>{m.icono}</Text></View>
                    <View style={{ flex: 1 }}>
                      <Text style={e.nombreMetodo}>{m.etiqueta}</Text>
                      <Text style={e.ayudaMetodo}>
                        {esUsd ? (tipoCambio ? `US$1 = $${tipoCambio.toFixed(2)} · da cambio en pesos` : "Falta el tipo de cambio en Caja") : daCambio ? "Lo que entrega el cliente (da cambio)" : "Monto exacto"}
                      </Text>
                    </View>
                    <View style={e.cajaMonto}>
                      <Text style={e.prefijo}>{esUsd ? "US$" : "$"}</Text>
                      <TextInput
                        value={valor}
                        onChangeText={(t) => setMontos((s) => ({ ...s, [m.valor]: t.replace(/[^0-9.,]/g, "") }))}
                        placeholder="0"
                        placeholderTextColor={colores.textoSecundario}
                        keyboardType="decimal-pad"
                        style={e.input}
                        accessibilityLabel={`Monto con ${m.etiqueta}`}
                      />
                    </View>
                    <TouchableOpacity onPress={() => resto(m.valor)} style={e.botonResto} accessibilityLabel={`Poner el resto en ${m.etiqueta}`}>
                      <Text style={e.botonRestoTexto}>Resto</Text>
                    </TouchableOpacity>
                  </View>
                  {esUsd && activo && tipoCambio ? <Text style={e.nota}>= ${(Number(valor.replace(",", ".")) * tipoCambio).toFixed(2)} en pesos</Text> : null}
                  {!daCambio && activo && (
                    <TextInput
                      value={referencias[m.valor] ?? ""}
                      onChangeText={(t) => setReferencias((s) => ({ ...s, [m.valor]: t }))}
                      placeholder="Referencia / autorización (opcional)"
                      placeholderTextColor={colores.textoSecundario}
                      maxLength={40}
                      style={e.inputReferencia}
                    />
                  )}
                </View>
              );
            })}
          </ScrollView>

          {r.error && <Text style={e.error}>{r.error}</Text>}

          {/* Pie */}
          <View style={e.pie}>
            <TouchableOpacity onPress={limpiar} style={[e.boton, e.botonSecundario]}>
              <Text style={{ color: colores.texto, fontWeight: "700" }}>Limpiar</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onCerrar} style={[e.boton, e.botonSecundario]}>
              <Text style={{ color: colores.texto, fontWeight: "700" }}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onUsar(entradas.filter((x) => x.cantidad > 0))}
              disabled={!listo}
              style={[e.boton, { flex: 2, backgroundColor: listo ? colores.green : colores.gray200 }]}
            >
              <Text style={{ color: listo ? "#fff" : colores.texto, fontWeight: "800", fontSize: 16 }}>✓ Usar estos pagos</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    fondo: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", padding: 16 },
    tarjeta: { width: "100%", maxWidth: 560, backgroundColor: colores.fondo, borderRadius: 18, overflow: "hidden" },
    encabezado: { flexDirection: "row", alignItems: "center", backgroundColor: colores.navy, paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 4, borderBottomColor: NARANJA },
    titulo: { color: "#fff", fontSize: 20, fontWeight: "800" },
    subtitulo: { color: "#CFD8E6", fontSize: 13, marginTop: 2 },
    cerrar: { color: "#fff", fontSize: 24, paddingHorizontal: 6 },
    cajaTotal: { margin: 16, padding: 14, borderRadius: 14, backgroundColor: colores.superficie, borderWidth: 1, borderColor: colores.borde },
    etiquetaTotal: { fontSize: 14, color: colores.textoSecundario, fontWeight: "700" },
    total: { fontSize: 28, fontWeight: "900", color: NARANJA },
    barra: { height: 10, borderRadius: 5, backgroundColor: colores.gray200, marginTop: 10, overflow: "hidden" },
    barraRelleno: { height: 10, borderRadius: 5 },
    detalle: { fontSize: 13, color: colores.textoSecundario },
    metodo: { borderWidth: 1, borderColor: colores.borde, borderRadius: 14, padding: 10, marginBottom: 10, backgroundColor: colores.superficie },
    metodoActivo: { borderColor: NARANJA, borderWidth: 2 },
    filaMetodo: { flexDirection: "row", alignItems: "center", gap: 10 },
    icono: { width: 44, height: 44, borderRadius: 22, backgroundColor: colores.gray50, alignItems: "center", justifyContent: "center" },
    nombreMetodo: { fontSize: 16, fontWeight: "800", color: colores.texto },
    ayudaMetodo: { fontSize: 11, color: colores.textoSecundario, marginTop: 2 },
    cajaMonto: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: colores.borde, borderRadius: 10, paddingHorizontal: 10, backgroundColor: colores.fondo, width: 130, minHeight: 48 },
    prefijo: { fontSize: 16, color: colores.textoSecundario, fontWeight: "700" },
    input: { flex: 1, fontSize: 20, fontWeight: "800", color: colores.texto, textAlign: "right", paddingVertical: 6 },
    botonResto: { paddingHorizontal: 12, minHeight: 48, borderRadius: 10, backgroundColor: colores.navy, alignItems: "center", justifyContent: "center" },
    botonRestoTexto: { color: "#fff", fontWeight: "800" },
    nota: { fontSize: 12, color: colores.textoSecundario, marginTop: 6, marginLeft: 54 },
    inputReferencia: { marginTop: 8, marginLeft: 54, minHeight: 42, borderWidth: 1, borderColor: colores.borde, borderRadius: 10, paddingHorizontal: 10, fontSize: 14, color: colores.texto, backgroundColor: colores.fondo },
    error: { color: colores.red, fontWeight: "700", paddingHorizontal: 16, marginBottom: 4 },
    pie: { flexDirection: "row", gap: 10, padding: 16, borderTopWidth: 1, borderTopColor: colores.borde },
    boton: { flex: 1, minHeight: 52, borderRadius: 12, alignItems: "center", justifyContent: "center" },
    botonSecundario: { backgroundColor: colores.gray50, borderWidth: 1, borderColor: colores.borde },
  });
}
