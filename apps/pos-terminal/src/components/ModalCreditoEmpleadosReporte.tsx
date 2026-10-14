import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { agruparConsumosPorEmpleada, describirProductoConsumido, type ConsumoPorEmpleada } from "@hangar421/shared";
import { usarColores } from "../store/temaStore";
import { abrirBaseDeDatos } from "../db/database";
import { consumosCreditoLocales } from "../db/creditoEmpleadosRepo";
import { formatearFecha } from "../reportes/armarReporte";
import { exportarCreditoExcel, exportarCreditoPdf } from "../reportes/exportarCredito";
import { obtenerNombreSucursal } from "../db/dispositivoLocal";

const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const hora = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const dia = (iso: string) => `${DIAS[new Date(iso).getDay()]} ${formatearFecha(iso)}`;

/**
 * Admin → Reportes → Crédito de empleados (solo administradores): qué consumió cada empleada con
 * su crédito en el periodo elegido, con día, fecha, hora, folio y productos. Sale de las ventas
 * de ESTA tablet (funciona sin red); el de todas las tablets está en el ERP.
 */
export function ModalCreditoEmpleadosReporte({ desdeIso, hastaIso, etiquetaPeriodo, onCerrar }: {
  desdeIso: string;
  hastaIso: string;
  etiquetaPeriodo: string;
  onCerrar: () => void;
}) {
  const colores = usarColores();
  const e = crearEstilos(colores);
  const [grupos, setGrupos] = useState<ConsumoPorEmpleada[] | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [exportando, setExportando] = useState<"pdf" | "excel" | null>(null);

  async function exportar(tipo: "pdf" | "excel") {
    if (!grupos || grupos.length === 0) return;
    setExportando(tipo);
    try {
      if (tipo === "pdf") {
        const sucursal = (await abrirBaseDeDatos().then(obtenerNombreSucursal).catch(() => null)) ?? "HANGAR 421";
        await exportarCreditoPdf(grupos, sucursal, etiquetaPeriodo);
      } else {
        await exportarCreditoExcel(grupos, etiquetaPeriodo);
      }
    } catch (e: any) {
      Alert.alert("Exportar", e?.message ?? "No se pudo generar el archivo.");
    } finally {
      setExportando(null);
    }
  }

  useEffect(() => {
    abrirBaseDeDatos()
      .then((db) => consumosCreditoLocales(db, desdeIso, hastaIso))
      .then((c) => {
        const g = agruparConsumosPorEmpleada(c);
        setGrupos(g);
        setAbierta(g[0]?.empleadoId ?? null);
      })
      .catch(() => setGrupos([]));
  }, [desdeIso, hastaIso]);

  const total = (grupos ?? []).reduce((s, g) => s + g.totalCredito, 0);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCerrar}>
      <View style={e.fondo}>
        <View style={e.caja}>
          <View style={e.encabezado}>
            <View style={{ flex: 1 }}>
              <Text style={e.titulo}>👛 Crédito de empleados</Text>
              <Text style={e.ayuda}>{etiquetaPeriodo} · ventas cobradas en esta tablet</Text>
            </View>
            <TouchableOpacity onPress={onCerrar} accessibilityLabel="Cerrar"><Text style={e.cerrar}>✕</Text></TouchableOpacity>
          </View>

          {grupos === null ? (
            <ActivityIndicator color={colores.navy} style={{ marginTop: 30 }} />
          ) : grupos.length === 0 ? (
            <Text style={[e.ayuda, { marginTop: 20 }]}>Nadie usó crédito de empleado en este periodo.</Text>
          ) : (
            <>
              <View style={e.totalCaja}>
                <Text style={e.ayuda}>Total consumido a crédito</Text>
                <Text style={e.totalTexto}>${total.toFixed(2)}</Text>
              </View>
              {/* Compartir abre el selector del sistema: ahí se elige Gmail/Outlook para mandarlo por correo. */}
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}>
                <TouchableOpacity onPress={() => exportar("pdf")} disabled={!!exportando} style={[e.botonExportar, { backgroundColor: colores.navy }]}>
                  {exportando === "pdf" ? <ActivityIndicator color="#fff" /> : <Text style={e.botonExportarTexto}>📄 PDF / correo</Text>}
                </TouchableOpacity>
                <TouchableOpacity onPress={() => exportar("excel")} disabled={!!exportando} style={[e.botonExportar, { backgroundColor: colores.green }]}>
                  {exportando === "excel" ? <ActivityIndicator color="#fff" /> : <Text style={e.botonExportarTexto}>📊 Excel / correo</Text>}
                </TouchableOpacity>
              </View>
              <ScrollView style={{ flex: 1 }}>
                {grupos.map((g) => (
                  <View key={g.empleadoId} style={e.tarjeta}>
                    <TouchableOpacity onPress={() => setAbierta(abierta === g.empleadoId ? null : g.empleadoId)} style={e.filaEmpleada}>
                      <Text style={e.nombre}>{abierta === g.empleadoId ? "▾" : "▸"} {g.empleado}</Text>
                      <Text style={e.ayuda}>{g.numConsumos} consumo(s)</Text>
                      <Text style={e.monto}>${g.totalCredito.toFixed(2)}</Text>
                    </TouchableOpacity>
                    {abierta === g.empleadoId && g.consumos.map((c) => (
                      <View key={c.ventaId} style={e.consumo}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                          <Text style={e.fecha}>{dia(c.fecha)} · {hora(c.fecha)}{c.folio ? `  ·  #${c.folio}` : ""}</Text>
                          <Text style={e.fecha}>${c.montoCredito.toFixed(2)}</Text>
                        </View>
                        {c.productos.map((p, i) => (
                          <Text key={i} style={e.producto}>{p.cantidad} × {describirProductoConsumido(p)}</Text>
                        ))}
                        {c.montoCredito < c.totalVenta && (
                          <Text style={e.ayuda}>Venta de ${c.totalVenta.toFixed(2)}; el resto con otro método.</Text>
                        )}
                      </View>
                    ))}
                  </View>
                ))}
              </ScrollView>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

function crearEstilos(c: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    fondo: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", padding: 16 },
    caja: { width: "100%", maxWidth: 620, height: "90%", backgroundColor: c.fondo, borderRadius: 14, padding: 16 },
    encabezado: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 10 },
    titulo: { fontSize: 20, fontWeight: "800", color: c.texto },
    cerrar: { fontSize: 20, color: c.textoSecundario },
    ayuda: { fontSize: 12, color: c.textoSecundario },
    totalCaja: { backgroundColor: c.superficie, borderRadius: 10, padding: 12, marginBottom: 10, borderLeftWidth: 4, borderLeftColor: c.amber },
    totalTexto: { fontSize: 24, fontWeight: "800", color: c.texto },
    tarjeta: { backgroundColor: c.superficie, borderRadius: 10, padding: 12, marginBottom: 8 },
    filaEmpleada: { flexDirection: "row", alignItems: "center", gap: 10 },
    nombre: { flex: 1, fontSize: 16, fontWeight: "800", color: c.texto },
    monto: { fontSize: 16, fontWeight: "800", color: c.amber },
    consumo: { borderTopWidth: 1, borderTopColor: c.borde, paddingTop: 8, marginTop: 8 },
    fecha: { fontSize: 13, fontWeight: "700", color: c.texto },
    producto: { fontSize: 13, color: c.texto, marginTop: 2 },
    botonExportar: { flex: 1, borderRadius: 10, minHeight: 46, alignItems: "center", justifyContent: "center" },
    botonExportarTexto: { color: "#fff", fontWeight: "800", fontSize: 14 },
  });
}
