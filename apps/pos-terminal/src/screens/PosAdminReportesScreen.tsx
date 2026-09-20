import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { usarColores } from "../store/temaStore";
import { abrirBaseDeDatos } from "../db/database";
import { obtenerNombreSucursal } from "../db/dispositivoLocal";
import {
  cajerosDelRango, detalleVentas, resumenVentas, topProductosVendidos,
  type CajeroDelRango, type FiltroReporte, type ProductoVendido, type ResumenVentas, type VentaDetalle,
} from "../db/reportesRepo";
import { etiquetaMetodoPago } from "../db/metodosPagoRepo";
import { formatearFecha, formatearFechaHora, formatearDinero, type DatosReporte } from "../reportes/armarReporte";
import { exportarExcel, exportarPdf } from "../reportes/exportar";

/** Inicio y fin del día en hora LOCAL, no UTC. Con `toISOString().slice(0,10)` un corte hecho a
 *  las 22:00 en México caía en el día siguiente y el reporte de "hoy" salía vacío. */
function inicioDelDia(d: Date): string {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString();
}
function finDelDia(d: Date): string {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x.toISOString();
}

type Preset = "hoy" | "ayer" | "7dias" | "mes";

function BarraHorizontal({ datos, colores }: { datos: { etiqueta: string; valor: number }[]; colores: ReturnType<typeof usarColores> }) {
  const max = Math.max(1, ...datos.map((d) => d.valor));
  return (
    <View style={{ gap: 8 }}>
      {datos.map((d, i) => (
        <View key={i}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ fontSize: 12, color: colores.texto, flex: 1 }} numberOfLines={1}>{d.etiqueta}</Text>
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
  const [fechaDesde, setFechaDesde] = useState(new Date(hoy.getTime() - 6 * 86_400_000));
  const [fechaHasta, setFechaHasta] = useState(hoy);
  const [abrirCalendario, setAbrirCalendario] = useState<"desde" | "hasta" | null>(null);
  const [cajeroId, setCajeroId] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");

  const [cajeros, setCajeros] = useState<CajeroDelRango[]>([]);
  const [resumen, setResumen] = useState<ResumenVentas | null>(null);
  const [topProductos, setTopProductos] = useState<ProductoVendido[]>([]);
  const [ventas, setVentas] = useState<VentaDetalle[]>([]);
  const [sucursal, setSucursal] = useState("HANGAR 421");
  const [generando, setGenerando] = useState(false);
  const [exportando, setExportando] = useState<"pdf" | "excel" | null>(null);
  // null = todavía no se ha generado nada. Distinto de "generado y sin resultados".
  const [generado, setGenerado] = useState(false);

  const filtro: FiltroReporte = {
    desde: inicioDelDia(fechaDesde),
    hasta: finDelDia(fechaHasta),
    usuarioId: cajeroId,
    busqueda,
  };

  /** La lista de cajeros depende solo del rango, no del resto de filtros: si dependiera del
   *  cajero elegido, al seleccionar uno desaparecerían los demás del selector. */
  const cargarCajeros = useCallback(async () => {
    const db = await abrirBaseDeDatos();
    setCajeros(await cajerosDelRango(db, inicioDelDia(fechaDesde), finDelDia(fechaHasta)));
  }, [fechaDesde, fechaHasta]);

  useEffect(() => {
    cargarCajeros();
    abrirBaseDeDatos().then(obtenerNombreSucursal).then((n) => n && setSucursal(n)).catch(() => undefined);
  }, [cargarCajeros]);

  async function generar() {
    setGenerando(true);
    try {
      const db = await abrirBaseDeDatos();
      const [r, t, v] = await Promise.all([
        resumenVentas(db, filtro),
        topProductosVendidos(db, filtro),
        detalleVentas(db, filtro),
      ]);
      setResumen(r);
      setTopProductos(t);
      setVentas(v);
      setGenerado(true);
    } catch (e: any) {
      Alert.alert("Reporte", e?.message ?? "No se pudo generar el reporte.");
    } finally {
      setGenerando(false);
    }
  }

  function aplicarPreset(p: Preset) {
    const ahora = new Date();
    if (p === "hoy") { setFechaDesde(ahora); setFechaHasta(ahora); }
    if (p === "ayer") {
      const ayer = new Date(ahora.getTime() - 86_400_000);
      setFechaDesde(ayer); setFechaHasta(ayer);
    }
    if (p === "7dias") { setFechaDesde(new Date(ahora.getTime() - 6 * 86_400_000)); setFechaHasta(ahora); }
    if (p === "mes") { setFechaDesde(new Date(ahora.getFullYear(), ahora.getMonth(), 1)); setFechaHasta(ahora); }
    setGenerado(false);
  }

  function datosParaExportar(): DatosReporte {
    return {
      sucursal,
      desde: filtro.desde,
      hasta: filtro.hasta,
      cajero: cajeros.find((c) => c.usuarioId === cajeroId)?.nombre ?? null,
      busqueda: busqueda.trim() || null,
      totalVentas: resumen?.totalVentas ?? 0,
      cantidadVentas: resumen?.cantidadVentas ?? 0,
      ticketPromedio: resumen?.ticketPromedio ?? 0,
      porMetodo: (resumen?.totalPorMetodo ?? []).map((m) => ({
        metodo: etiquetaMetodoPago[m.metodo as keyof typeof etiquetaMetodoPago] ?? m.metodo,
        total: m.total,
        cantidad: m.cantidad,
      })),
      topProductos,
      ventas,
    };
  }

  async function exportar(formato: "pdf" | "excel") {
    setExportando(formato);
    try {
      const datos = datosParaExportar();
      if (formato === "pdf") await exportarPdf(datos);
      else await exportarExcel(datos);
    } catch (e: any) {
      // Compartir puede fallar por permisos o porque el usuario cancele: nunca debe tumbar la
      // pantalla ni perder el reporte ya generado.
      Alert.alert("Exportar", e?.message ?? "No se pudo exportar el reporte.");
    } finally {
      setExportando(null);
    }
  }

  const sinResultados = generado && (resumen?.cantidadVentas ?? 0) === 0;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colores.fondo }} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <View style={estilos.encabezado}>
        <Text style={estilos.titulo}>Reportes</Text>
        <TouchableOpacity onPress={onCerrar}><Text style={estilos.cerrar}>✕</Text></TouchableOpacity>
      </View>

      <View style={estilos.tarjeta}>
        <Text style={estilos.subtitulo}>Periodo</Text>

        {/* La mayoría de las consultas son uno de estos cuatro rangos: un toque en vez de dos
            calendarios. El calendario queda para lo demás. */}
        <View style={estilos.chips}>
          {([["hoy", "Hoy"], ["ayer", "Ayer"], ["7dias", "7 días"], ["mes", "Este mes"]] as [Preset, string][]).map(([id, etiqueta]) => (
            <TouchableOpacity key={id} onPress={() => aplicarPreset(id)} style={estilos.chip}>
              <Text style={estilos.chipTexto}>{etiqueta}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
          <TouchableOpacity onPress={() => setAbrirCalendario("desde")} style={estilos.campoFecha}>
            <Text style={estilos.etiquetaCampo}>Desde</Text>
            <Text style={estilos.valorFecha}>📅 {formatearFecha(fechaDesde.toISOString())}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setAbrirCalendario("hasta")} style={estilos.campoFecha}>
            <Text style={estilos.etiquetaCampo}>Hasta</Text>
            <Text style={estilos.valorFecha}>📅 {formatearFecha(fechaHasta.toISOString())}</Text>
          </TouchableOpacity>
        </View>

        {abrirCalendario && (
          <DateTimePicker
            value={abrirCalendario === "desde" ? fechaDesde : fechaHasta}
            mode="date"
            display={Platform.OS === "ios" ? "inline" : "calendar"}
            // No se puede pedir un reporte del futuro; y "desde" nunca después de "hasta".
            maximumDate={abrirCalendario === "desde" ? fechaHasta : new Date()}
            minimumDate={abrirCalendario === "hasta" ? fechaDesde : undefined}
            onChange={(evento, fecha) => {
              setAbrirCalendario(null);
              if (evento.type === "dismissed" || !fecha) return;
              if (abrirCalendario === "desde") setFechaDesde(fecha);
              else setFechaHasta(fecha);
              setGenerado(false);
            }}
          />
        )}
      </View>

      <View style={estilos.tarjeta}>
        <Text style={estilos.subtitulo}>Filtros</Text>

        <Text style={estilos.etiquetaCampo}>Cajero</Text>
        <View style={estilos.chips}>
          <TouchableOpacity onPress={() => { setCajeroId(null); setGenerado(false); }} style={[estilos.chip, !cajeroId && estilos.chipActivo]}>
            <Text style={[estilos.chipTexto, !cajeroId && estilos.chipTextoActivo]}>Todos</Text>
          </TouchableOpacity>
          {cajeros.map((c) => (
            <TouchableOpacity key={c.usuarioId} onPress={() => { setCajeroId(c.usuarioId); setGenerado(false); }} style={[estilos.chip, cajeroId === c.usuarioId && estilos.chipActivo]}>
              <Text style={[estilos.chipTexto, cajeroId === c.usuarioId && estilos.chipTextoActivo]}>{c.nombre} ({c.ventas})</Text>
            </TouchableOpacity>
          ))}
        </View>
        {cajeros.length === 0 && <Text style={estilos.ayuda}>Sin ventas en este periodo, así que no hay cajeros que filtrar.</Text>}

        <Text style={[estilos.etiquetaCampo, { marginTop: 12 }]}>Producto</Text>
        <TextInput
          value={busqueda}
          onChangeText={(v) => { setBusqueda(v); setGenerado(false); }}
          placeholder="Ej. latte — deja vacío para todos"
          placeholderTextColor={colores.textoSecundario}
          autoCapitalize="none"
          style={estilos.input}
        />
      </View>

      <TouchableOpacity onPress={generar} disabled={generando} style={[estilos.botonGenerar, generando && { opacity: 0.6 }]}>
        {generando ? <ActivityIndicator color="#fff" /> : <Text style={estilos.botonGenerarTexto}>Generar reporte</Text>}
      </TouchableOpacity>

      {!generado && !generando && (
        <Text style={[estilos.ayuda, { textAlign: "center", marginTop: 10 }]}>
          Elige el periodo y los filtros, y pulsa Generar.
        </Text>
      )}

      {generado && (
        <>
          <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
            <View style={[estilos.stat, { borderColor: colores.green }]}>
              <Text style={estilos.statValor}>{formatearDinero(resumen?.totalVentas ?? 0)}</Text>
              <Text style={estilos.ayuda}>Total vendido</Text>
            </View>
            <View style={[estilos.stat, { borderColor: colores.blue }]}>
              <Text style={estilos.statValor}>{resumen?.cantidadVentas ?? 0}</Text>
              <Text style={estilos.ayuda}>Ventas</Text>
            </View>
            <View style={[estilos.stat, { borderColor: colores.amber }]}>
              <Text style={estilos.statValor}>{formatearDinero(resumen?.ticketPromedio ?? 0)}</Text>
              <Text style={estilos.ayuda}>Ticket promedio</Text>
            </View>
          </View>

          {/* Exportar solo tiene sentido con datos: con cero ventas produciría un PDF vacío que
              parece un error de la app. */}
          {!sinResultados && (
            <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
              <TouchableOpacity onPress={() => exportar("pdf")} disabled={exportando !== null} style={[estilos.botonExportar, { backgroundColor: colores.red }]}>
                {exportando === "pdf" ? <ActivityIndicator color="#fff" size="small" /> : <Text style={estilos.botonExportarTexto}>📄 PDF</Text>}
              </TouchableOpacity>
              <TouchableOpacity onPress={() => exportar("excel")} disabled={exportando !== null} style={[estilos.botonExportar, { backgroundColor: colores.green }]}>
                {exportando === "excel" ? <ActivityIndicator color="#fff" size="small" /> : <Text style={estilos.botonExportarTexto}>📊 Excel</Text>}
              </TouchableOpacity>
            </View>
          )}
          {!sinResultados && (
            <Text style={[estilos.ayuda, { marginTop: 8 }]}>
              Al exportar se abre el menú de compartir: desde ahí puedes mandarlo por correo, WhatsApp o guardarlo.
            </Text>
          )}

          {sinResultados ? (
            <View style={estilos.tarjeta}>
              <Text style={estilos.ayuda}>No hay ventas que cumplan estos filtros. Prueba a ampliar el periodo o quitar el filtro de producto.</Text>
            </View>
          ) : (
            <>
              <View style={estilos.tarjeta}>
                <Text style={estilos.subtitulo}>Por método de pago</Text>
                <BarraHorizontal
                  colores={colores}
                  datos={(resumen?.totalPorMetodo ?? []).map((m) => ({
                    etiqueta: `${etiquetaMetodoPago[m.metodo as keyof typeof etiquetaMetodoPago] ?? m.metodo} (${m.cantidad})`,
                    valor: m.total,
                  }))}
                />
              </View>

              <View style={estilos.tarjeta}>
                <Text style={estilos.subtitulo}>Productos más vendidos</Text>
                <BarraHorizontal colores={colores} datos={topProductos.map((p) => ({ etiqueta: p.nombre, valor: p.cantidad }))} />
              </View>

              <View style={estilos.tarjeta}>
                <Text style={estilos.subtitulo}>Detalle ({ventas.length})</Text>
                {ventas.slice(0, 50).map((v) => (
                  <View key={v.id} style={estilos.filaVenta}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colores.texto, fontSize: 13, fontWeight: "600" }}>
                        #{v.folioLocal} · {formatearFechaHora(v.createdAt)}
                      </Text>
                      <Text style={estilos.ayuda} numberOfLines={2}>{v.cajero} · {v.metodos} · {v.productos}</Text>
                    </View>
                    <Text style={{ color: colores.navyTexto, fontWeight: "700" }}>{formatearDinero(v.total)}</Text>
                  </View>
                ))}
                {ventas.length > 50 && (
                  <Text style={[estilos.ayuda, { marginTop: 8 }]}>
                    Se muestran 50 de {ventas.length}. El archivo exportado las lleva todas.
                  </Text>
                )}
              </View>
            </>
          )}
        </>
      )}
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
    etiquetaCampo: { fontSize: 11, color: colores.textoSecundario, fontWeight: "700", textTransform: "uppercase", marginBottom: 6 },
    input: { borderWidth: 1, borderColor: colores.borde, borderRadius: 8, padding: 12, minHeight: 44, color: colores.texto, fontSize: 15 },
    tarjeta: { backgroundColor: colores.superficie, borderRadius: 14, padding: 16, marginBottom: 14 },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, backgroundColor: colores.gray50, minHeight: 40, justifyContent: "center" },
    chipActivo: { backgroundColor: colores.navy },
    chipTexto: { fontSize: 13, fontWeight: "600", color: colores.texto },
    chipTextoActivo: { color: "#fff" },
    campoFecha: { flex: 1, borderWidth: 1, borderColor: colores.borde, borderRadius: 8, padding: 10, minHeight: 56, justifyContent: "center" },
    valorFecha: { fontSize: 15, fontWeight: "700", color: colores.texto },
    botonGenerar: { backgroundColor: colores.navy, borderRadius: 12, padding: 16, alignItems: "center", minHeight: 52, justifyContent: "center", marginTop: 4 },
    botonGenerarTexto: { color: "#fff", fontWeight: "800", fontSize: 16 },
    botonExportar: { flex: 1, borderRadius: 10, padding: 14, alignItems: "center", minHeight: 48, justifyContent: "center" },
    botonExportarTexto: { color: "#fff", fontWeight: "700", fontSize: 14 },
    stat: { flex: 1, backgroundColor: colores.superficie, borderRadius: 12, borderLeftWidth: 4, padding: 12 },
    statValor: { fontSize: 17, fontWeight: "800", color: colores.texto },
    filaVenta: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colores.borde },
  });
}
