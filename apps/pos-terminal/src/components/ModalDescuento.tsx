import { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { TipoDescuento, round2 } from "@hangar421/shared";
import { usarColores } from "../store/temaStore";
import type { ItemCarrito } from "../store/carritoStore";
import { SIN_DESCUENTOS, etiquetaDescuento, hayDescuentos, totalesConDescuentos, validarDescuento, type DescuentosVenta } from "../caja/descuentoVenta";

const NARANJA = "#FF6A13";

type Paso = "alcance" | "general" | "producto";

/** Descuento del cobro. Primero pregunta si es GENERAL (toda la cuenta) o POR PRODUCTO (una o
 *  varias líneas); en los dos casos se elige porcentaje o monto fijo. No pide PIN. Trabaja sobre
 *  un borrador: nada cambia en la venta hasta que se aplica. */
export function ModalDescuento({
  items,
  inicial,
  onAplicar,
  onCerrar,
}: {
  items: ItemCarrito[];
  inicial: DescuentosVenta;
  onAplicar: (descuentos: DescuentosVenta) => void;
  onCerrar: () => void;
}) {
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const [paso, setPaso] = useState<Paso>("alcance");
  const [borrador, setBorrador] = useState<DescuentosVenta>(inicial);
  const [lineaId, setLineaId] = useState<string | null>(null);
  const [tipo, setTipo] = useState<TipoDescuento>(TipoDescuento.PORCENTAJE);
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);

  const totales = totalesConDescuentos(items, borrador);
  const linea = items.find((i) => i.id === lineaId) ?? null;

  function abrirEditor(actual: { tipo: TipoDescuento; valor: number } | null | undefined) {
    setTipo(actual?.tipo ?? TipoDescuento.PORCENTAJE);
    setTexto(actual ? String(actual.valor) : "");
    setError(null);
  }

  function irA(destino: Paso) {
    setPaso(destino);
    setLineaId(null);
    if (destino === "general") abrirEditor(borrador.general);
  }

  function elegirLinea(id: string) {
    setLineaId(id);
    abrirEditor(borrador.porProducto[id]);
  }

  /** Valida lo escrito y devuelve el descuento, o null (con el error en pantalla). */
  function leer(): { tipo: TipoDescuento; valor: number } | null {
    const valor = Number(texto.replace(",", "."));
    const problema = validarDescuento(tipo, valor);
    if (problema) {
      setError(problema);
      return null;
    }
    return { tipo, valor: round2(valor) };
  }

  function aplicarGeneral() {
    const d = leer();
    if (d) onAplicar({ ...borrador, general: d });
  }

  function aplicarALinea() {
    const d = leer();
    if (!d || !lineaId) return;
    setBorrador({ ...borrador, porProducto: { ...borrador.porProducto, [lineaId]: d } });
    setLineaId(null);
  }

  function quitarDeLinea(id: string) {
    const { [id]: _quitado, ...resto } = borrador.porProducto;
    setBorrador({ ...borrador, porProducto: resto });
    setLineaId(null);
  }

  /** Porcentaje o monto fijo + el número. Se reutiliza para el descuento general y el de cada producto. */
  const editor = (
    <View style={estilos.editor}>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {([[TipoDescuento.PORCENTAJE, "% Porcentaje"], [TipoDescuento.MONTO, "$ Monto fijo"]] as const).map(([valor, etiqueta]) => (
          <TouchableOpacity key={valor} onPress={() => { setTipo(valor); setError(null); }} style={[estilos.segmento, tipo === valor && estilos.segmentoActivo]} accessibilityLabel={etiqueta}>
            <Text style={[estilos.segmentoTexto, tipo === valor && { color: "#fff" }]}>{etiqueta}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TextInput
        value={texto}
        onChangeText={(t) => { setTexto(t); setError(null); }}
        placeholder={tipo === TipoDescuento.PORCENTAJE ? "Ej. 10" : "Ej. 25"}
        placeholderTextColor={colores.textoSecundario}
        keyboardType="decimal-pad"
        autoFocus
        maxLength={8}
        style={estilos.input}
        accessibilityLabel={tipo === TipoDescuento.PORCENTAJE ? "Porcentaje de descuento" : "Monto de descuento"}
      />
      {error && <Text style={estilos.error}>{error}</Text>}
    </View>
  );

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCerrar}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={estilos.fondo}>
        <View style={estilos.tarjeta}>
          {paso === "alcance" && (
            <>
              <Text style={estilos.titulo}>🏷 Descuento</Text>
              <Text style={estilos.ayuda}>¿El descuento es para toda la cuenta o para un producto?</Text>
              <TouchableOpacity onPress={() => irA("general")} style={estilos.opcion} accessibilityLabel="Descuento general">
                <Text style={estilos.opcionTitulo}>Descuento general</Text>
                <Text style={estilos.opcionAyuda}>A toda la cuenta{borrador.general ? ` · ahora ${etiquetaDescuento(borrador.general)}` : ""}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => irA("producto")} style={estilos.opcion} accessibilityLabel="Descuento por producto">
                <Text style={estilos.opcionTitulo}>Descuento por producto</Text>
                <Text style={estilos.opcionAyuda}>
                  Eliges uno o varios productos{Object.keys(borrador.porProducto).length > 0 ? ` · ahora en ${Object.keys(borrador.porProducto).length}` : ""}
                </Text>
              </TouchableOpacity>
              <View style={estilos.botones}>
                {hayDescuentos(inicial) && (
                  <TouchableOpacity onPress={() => onAplicar(SIN_DESCUENTOS)} style={[estilos.boton, estilos.botonSecundario]} accessibilityLabel="Quitar todos los descuentos">
                    <Text style={[estilos.textoSecundario, { color: colores.red }]}>Quitar descuentos</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={onCerrar} style={[estilos.boton, estilos.botonSecundario]} accessibilityLabel="Cancelar">
                  <Text style={estilos.textoSecundario}>Cancelar</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {paso === "general" && (
            <>
              <Text style={estilos.titulo}>Descuento general</Text>
              <Text style={estilos.ayuda}>Se aplica a toda la cuenta{hayDescuentos({ general: null, porProducto: borrador.porProducto }) ? ", después de los descuentos por producto" : ""}. Cuenta actual: ${totales.subtotal.toFixed(2)}.</Text>
              {editor}
              <View style={estilos.botones}>
                <TouchableOpacity onPress={() => irA("alcance")} style={[estilos.boton, estilos.botonSecundario]} accessibilityLabel="Atrás">
                  <Text style={estilos.textoSecundario}>Atrás</Text>
                </TouchableOpacity>
                {borrador.general && (
                  <TouchableOpacity onPress={() => onAplicar({ ...borrador, general: null })} style={[estilos.boton, estilos.botonSecundario]} accessibilityLabel="Quitar descuento general">
                    <Text style={[estilos.textoSecundario, { color: colores.red }]}>Quitar</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={aplicarGeneral} style={[estilos.boton, estilos.botonPrincipal]} accessibilityLabel="Aplicar descuento general">
                  <Text style={estilos.textoPrincipal}>Aplicar</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {paso === "producto" && (
            <>
              <Text style={estilos.titulo}>Descuento por producto</Text>
              <Text style={estilos.ayuda}>{linea ? `${linea.cantidad}× ${linea.nombreProducto}` : "Toca el producto al que se le hace el descuento."}</Text>
              {linea ? (
                <>
                  {editor}
                  <View style={estilos.botones}>
                    <TouchableOpacity onPress={() => setLineaId(null)} style={[estilos.boton, estilos.botonSecundario]} accessibilityLabel="Atrás">
                      <Text style={estilos.textoSecundario}>Atrás</Text>
                    </TouchableOpacity>
                    {borrador.porProducto[linea.id] && (
                      <TouchableOpacity onPress={() => quitarDeLinea(linea.id)} style={[estilos.boton, estilos.botonSecundario]} accessibilityLabel="Quitar descuento del producto">
                        <Text style={[estilos.textoSecundario, { color: colores.red }]}>Quitar</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity onPress={aplicarALinea} style={[estilos.boton, estilos.botonPrincipal]} accessibilityLabel="Aplicar al producto">
                      <Text style={estilos.textoPrincipal}>Aplicar</Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <>
                  <ScrollView style={{ maxHeight: 320 }}>
                    {items.map((item, indice) => {
                      const d = borrador.porProducto[item.id];
                      const importe = round2((item.precioUnitario + item.modificadores.reduce((s, m) => s + m.precioExtra, 0)) * item.cantidad);
                      return (
                        <TouchableOpacity key={item.id} onPress={() => elegirLinea(item.id)} style={[estilos.filaProducto, d && { borderColor: NARANJA }]} accessibilityLabel={`Descuento a ${item.nombreProducto}`}>
                          <View style={{ flex: 1 }}>
                            <Text style={estilos.opcionTitulo}>{item.cantidad}× {item.nombreProducto}</Text>
                            {d && <Text style={[estilos.opcionAyuda, { color: NARANJA, fontWeight: "700" }]}>Descuento {etiquetaDescuento(d)} · −${totales.porLinea[indice].toFixed(2)}</Text>}
                          </View>
                          <Text style={{ color: colores.texto, fontWeight: "700" }}>${importe.toFixed(2)}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                  <Text style={estilos.resumen}>Total con descuentos: ${totales.total.toFixed(2)}</Text>
                  <View style={estilos.botones}>
                    <TouchableOpacity onPress={() => irA("alcance")} style={[estilos.boton, estilos.botonSecundario]} accessibilityLabel="Atrás">
                      <Text style={estilos.textoSecundario}>Atrás</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => onAplicar(borrador)} style={[estilos.boton, estilos.botonPrincipal]} accessibilityLabel="Listo">
                      <Text style={estilos.textoPrincipal}>Listo</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    fondo: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 20 },
    tarjeta: { width: "100%", maxWidth: 460, backgroundColor: colores.superficie, borderRadius: 16, padding: 20 },
    titulo: { fontSize: 19, fontWeight: "800", color: colores.texto },
    ayuda: { fontSize: 13, color: colores.textoSecundario, marginTop: 4, marginBottom: 14 },
    opcion: { borderWidth: 1, borderColor: colores.borde, borderRadius: 12, padding: 14, marginBottom: 10, minHeight: 64, justifyContent: "center", backgroundColor: colores.fondo },
    opcionTitulo: { fontSize: 16, fontWeight: "800", color: colores.texto },
    opcionAyuda: { fontSize: 12, color: colores.textoSecundario, marginTop: 2 },
    filaProducto: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: colores.borde, borderRadius: 12, padding: 12, marginBottom: 8, minHeight: 56, backgroundColor: colores.fondo },
    resumen: { fontWeight: "800", color: colores.texto, textAlign: "right", marginTop: 6 },
    editor: { gap: 10 },
    segmento: { flex: 1, minHeight: 46, borderRadius: 10, borderWidth: 1, borderColor: colores.borde, alignItems: "center", justifyContent: "center", backgroundColor: colores.fondo },
    segmentoActivo: { backgroundColor: NARANJA, borderColor: NARANJA },
    segmentoTexto: { color: colores.texto, fontWeight: "800" },
    input: { minHeight: 52, borderWidth: 1, borderColor: colores.borde, borderRadius: 10, paddingHorizontal: 12, fontSize: 22, fontWeight: "700", color: colores.texto, textAlign: "center" },
    error: { color: colores.red, fontSize: 13 },
    botones: { flexDirection: "row", gap: 10, marginTop: 16 },
    boton: { flex: 1, minHeight: 48, borderRadius: 10, alignItems: "center", justifyContent: "center" },
    botonSecundario: { backgroundColor: colores.gray50 },
    botonPrincipal: { backgroundColor: colores.green },
    textoSecundario: { color: colores.texto, fontWeight: "700" },
    textoPrincipal: { color: "#fff", fontWeight: "700", fontSize: 16 },
  });
}
