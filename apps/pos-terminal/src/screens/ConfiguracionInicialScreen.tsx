import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { usarColores } from "../store/temaStore";
import { abrirBaseDeDatos } from "../db/database";
import { obtenerDatosFiscales, guardarDatosFiscales, marcarPrimerArranqueCompletado, type DatosFiscales } from "../db/configFiscalRepo";
import { sembrarMetodosPagoPorDefecto, listarMetodosPago, alternarMetodoPago, etiquetaMetodoPago, type MetodoPagoConfig } from "../db/metodosPagoRepo";

/** Primer arranque — separado a propósito de ConexionErpScreen (esto es configuración LOCAL,
 *  esa es la conexión OPCIONAL al ERP): nombre de sucursal, datos fiscales/ticket, impuesto,
 *  impresora, métodos de pago habilitados. No pide nada de red — el Punto de Venta puede
 *  terminar este wizard y vender de inmediato sin haber tocado ConexionErpScreen nunca. */
export function ConfiguracionInicialScreen({ onListo }: { onListo: () => void }) {
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const [datos, setDatos] = useState<DatosFiscales | null>(null);
  const [metodos, setMetodos] = useState<MetodoPagoConfig[]>([]);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    (async () => {
      const db = await abrirBaseDeDatos();
      await sembrarMetodosPagoPorDefecto(db);
      setDatos(await obtenerDatosFiscales(db));
      setMetodos(await listarMetodosPago(db));
    })();
  }, []);

  async function alternar(id: string, habilitado: boolean) {
    const db = await abrirBaseDeDatos();
    await alternarMetodoPago(db, id, habilitado);
    setMetodos(await listarMetodosPago(db));
  }

  async function finalizar() {
    if (!datos || !datos.nombreSucursalLocal.trim()) return;
    setGuardando(true);
    try {
      const db = await abrirBaseDeDatos();
      await guardarDatosFiscales(db, datos);
      await marcarPrimerArranqueCompletado(db);
      onListo();
    } finally {
      setGuardando(false);
    }
  }

  if (!datos) return null;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colores.fondo }} contentContainerStyle={{ padding: 20 }}>
      <Text style={estilos.titulo}>Configuración inicial</Text>
      <Text style={estilos.ayuda}>Se hace una sola vez, en este dispositivo. Todo aquí es local — no necesita conexión.</Text>

      <Text style={estilos.subtitulo}>Sucursal</Text>
      <TextInput placeholder="Nombre de esta sucursal/terminal" placeholderTextColor={colores.textoSecundario} value={datos.nombreSucursalLocal} onChangeText={(v) => setDatos({ ...datos, nombreSucursalLocal: v })} style={estilos.input} />

      <Text style={estilos.subtitulo}>Datos fiscales del ticket</Text>
      <TextInput placeholder="Razón social" placeholderTextColor={colores.textoSecundario} value={datos.razonSocial} onChangeText={(v) => setDatos({ ...datos, razonSocial: v })} style={estilos.input} />
      <TextInput placeholder="RFC" placeholderTextColor={colores.textoSecundario} value={datos.rfc} onChangeText={(v) => setDatos({ ...datos, rfc: v })} autoCapitalize="characters" style={estilos.input} />
      <TextInput placeholder="Dirección" placeholderTextColor={colores.textoSecundario} value={datos.direccion} onChangeText={(v) => setDatos({ ...datos, direccion: v })} style={estilos.input} />
      <TextInput placeholder="Pie del ticket (ej. ¡Gracias por su compra!)" placeholderTextColor={colores.textoSecundario} value={datos.pieTicket} onChangeText={(v) => setDatos({ ...datos, pieTicket: v })} style={estilos.input} />

      <Text style={estilos.subtitulo}>Impuesto</Text>
      <TextInput
        placeholder="Tasa (ej. 0.16 para 16%)"
        placeholderTextColor={colores.textoSecundario}
        value={String(datos.tasaImpuesto)}
        onChangeText={(v) => setDatos({ ...datos, tasaImpuesto: Number(v) || 0 })}
        keyboardType="decimal-pad"
        style={estilos.input}
      />

      <Text style={estilos.subtitulo}>Impresora térmica</Text>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <TouchableOpacity onPress={() => setDatos({ ...datos, anchoImpresoraMM: 58 })} style={[estilos.chip, datos.anchoImpresoraMM === 58 && estilos.chipActivo]}>
          <Text style={{ color: datos.anchoImpresoraMM === 58 ? "#fff" : colores.texto, fontWeight: "700" }}>58 mm</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setDatos({ ...datos, anchoImpresoraMM: 80 })} style={[estilos.chip, datos.anchoImpresoraMM === 80 && estilos.chipActivo]}>
          <Text style={{ color: datos.anchoImpresoraMM === 80 ? "#fff" : colores.texto, fontWeight: "700" }}>80 mm</Text>
        </TouchableOpacity>
      </View>

      <Text style={estilos.subtitulo}>Métodos de pago habilitados</Text>
      {metodos.map((m) => (
        <TouchableOpacity key={m.id} onPress={() => alternar(m.id, !m.habilitado)} style={estilos.filaMetodo}>
          <Text style={{ color: colores.texto }}>{etiquetaMetodoPago[m.tipo]}</Text>
          <View style={[estilos.interruptor, m.habilitado && estilos.interruptorActivo]}>
            <Text style={{ color: m.habilitado ? "#fff" : colores.textoSecundario, fontSize: 12, fontWeight: "700" }}>{m.habilitado ? "ON" : "OFF"}</Text>
          </View>
        </TouchableOpacity>
      ))}

      <TouchableOpacity onPress={finalizar} disabled={guardando || !datos.nombreSucursalLocal.trim()} style={estilos.boton}>
        <Text style={estilos.botonTexto}>{guardando ? "Guardando…" : "Empezar a vender"}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    titulo: { fontSize: 24, fontWeight: "800", color: colores.texto, marginBottom: 4 },
    ayuda: { fontSize: 13, color: colores.textoSecundario, marginBottom: 20, lineHeight: 18 },
    subtitulo: { fontSize: 15, fontWeight: "800", color: colores.texto, marginTop: 18, marginBottom: 8 },
    input: { borderWidth: 1, borderColor: colores.borde, borderRadius: 10, padding: 14, marginBottom: 8, fontSize: 15, color: colores.texto },
    chip: { paddingHorizontal: 18, paddingVertical: 12, borderRadius: 10, backgroundColor: colores.gray50, borderWidth: 1, borderColor: colores.borde },
    chipActivo: { backgroundColor: colores.navy, borderColor: colores.navy },
    filaMetodo: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colores.borde },
    interruptor: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20, backgroundColor: colores.gray200 },
    interruptorActivo: { backgroundColor: colores.green },
    boton: { backgroundColor: colores.green, borderRadius: 12, padding: 16, alignItems: "center", marginTop: 24, marginBottom: 30, minHeight: 52, justifyContent: "center" },
    botonTexto: { color: "#fff", fontWeight: "700", fontSize: 16 },
  });
}
