import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { usarColores } from "../store/temaStore";
import { abrirBaseDeDatos } from "../db/database";
import { resumenVentas, topProductosVendidos, type ResumenVentas, type ProductoVendido } from "../db/reportesRepo";
import { etiquetaMetodoPago } from "../db/metodosPagoRepo";

function fechaISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function BarraHorizontal({ datos, colores }: { datos: { etiqueta: string; valor: number }[]; colores: ReturnType<typeof usarColores> }) {
  const max = Math.max(1, ...datos.map((d) => d.valor));
  return (
    <View style={{ gap: 8 }}>
      {datos.map((d, i) => (
        <View key={i}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ fontSize: 12, color: colores.texto }} numberOfLines={1}>{d.etiqueta}</Text>
            <Text style={{ fontSize: 12, color: colores.textoSecundario }}>{d.valor.toFixed(2)}</Text>
          </View>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: colores.gray200, marginTop: 3 }}>
            <View style={{ height: 8, borderRadius: 4, width: `${(d.valor / max) * 100}%`, backgroundColor: colores.navy }} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function PosAdminReportesScreen({ onCerrar }: { onCerrar: () => void }) {
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const hoy = new Date();
  const hace7dias = new Date(hoy.getTime() - 7 * 86_400_000);
  const [desde, setDesde] = useState(fechaISO(hace7dias));
  const [hasta, setHasta] = useState(fechaISO(hoy));
  const [resumen, setResumen] = useState<ResumenVentas | null>(null);
  const [topProductos, setTopProductos] = useState<ProductoVendido[]>([]);

  async function cargar() {
    const db = await abrirBaseDeDatos();
    const rangoDesde = `${desde}T00:00:00.000Z`;
    const rangoHasta = `${hasta}T23:59:59.999Z`;
    setResumen(await resumenVentas(db, rangoDesde, rangoHasta));
    setTopProductos(await topProductosVendidos(db, rangoDesde, rangoHasta));
  }

  useEffect(() => {
    cargar();
  }, [desde, hasta]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colores.fondo }} contentContainerStyle={{ padding: 16 }}>
      <View style={estilos.encabezado}>
        <Text style={estilos.titulo}>Reportes (local)</Text>
        <TouchableOpacity onPress={onCerrar}><Text style={estilos.cerrar}>✕</Text></TouchableOpacity>
      </View>

      <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
        <TextInput value={desde} onChangeText={setDesde} placeholder="AAAA-MM-DD" placeholderTextColor={colores.textoSecundario} style={[estilos.input, { flex: 1 }]} />
        <TextInput value={hasta} onChangeText={setHasta} placeholder="AAAA-MM-DD" placeholderTextColor={colores.textoSecundario} style={[estilos.input, { flex: 1 }]} />
      </View>

      <View style={{ flexDirection: "row", gap: 10, marginBottom: 16 }}>
        <View style={[estilos.stat, { borderColor: colores.green }]}>
          <Text style={estilos.statValor}>${(resumen?.totalVentas ?? 0).toFixed(2)}</Text>
          <Text style={estilos.ayuda}>Ventas en el rango</Text>
        </View>
        <View style={[estilos.stat, { borderColor: colores.blue }]}>
          <Text style={estilos.statValor}>{resumen?.cantidadVentas ?? 0}</Text>
          <Text style={estilos.ayuda}>Ventas registradas</Text>
        </View>
      </View>

      <View style={estilos.tarjeta}>
        <Text style={estilos.subtitulo}>Ventas por método de pago</Text>
        {resumen && resumen.totalPorMetodo.length > 0 ? (
          <BarraHorizontal colores={colores} datos={resumen.totalPorMetodo.map((m) => ({ etiqueta: `${etiquetaMetodoPago[m.metodo as keyof typeof etiquetaMetodoPago] ?? m.metodo} (${m.cantidad})`, valor: m.total }))} />
        ) : (
          <Text style={estilos.ayuda}>Sin pagos en este rango.</Text>
        )}
      </View>

      <View style={estilos.tarjeta}>
        <Text style={estilos.subtitulo}>Top productos (por unidades)</Text>
        {topProductos.length > 0 ? (
          <BarraHorizontal colores={colores} datos={topProductos.map((p) => ({ etiqueta: p.nombre, valor: p.cantidad }))} />
        ) : (
          <Text style={estilos.ayuda}>Sin ventas en este rango.</Text>
        )}
      </View>
    </ScrollView>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    encabezado: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
    titulo: { fontSize: 22, fontWeight: "800", color: colores.texto },
    cerrar: { color: colores.textoSecundario, fontSize: 20 },
    subtitulo: { fontSize: 15, fontWeight: "800", color: colores.texto, marginBottom: 10 },
    ayuda: { fontSize: 12, color: colores.textoSecundario },
    input: { borderWidth: 1, borderColor: colores.borde, borderRadius: 8, padding: 10, color: colores.texto },
    tarjeta: { backgroundColor: colores.superficie, borderRadius: 14, padding: 16, marginBottom: 14 },
    stat: { flex: 1, backgroundColor: colores.superficie, borderRadius: 12, borderLeftWidth: 4, padding: 12 },
    statValor: { fontSize: 20, fontWeight: "800", color: colores.texto },
  });
}
