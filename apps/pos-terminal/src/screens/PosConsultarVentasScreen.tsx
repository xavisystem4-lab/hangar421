import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { usarColores } from "../store/temaStore";
import { useAuthLocalStore } from "../store/authLocalStore";
import { abrirBaseDeDatos } from "../db/database";
import { consultarVentas, detalleTicket, type FiltroConsulta, type LineaTicket, type VentaConsulta } from "../db/ventasHistorialRepo";
import { cancelarVenta } from "../db/ventasRepo";
import { cajerosDelRango, type CajeroDelRango } from "../db/reportesRepo";
import { procesarCola } from "../sync/syncEngine";
import { ModalAutorizacion } from "../components/ModalAutorizacion";
import { formatearDinero, formatearFechaHora } from "../reportes/armarReporte";
import type { Autorizador } from "../auth/autorizacion";

type RangoRapido = "hoy" | "7dias" | "30dias";

function inicioDelDia(d: Date): string {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x.toISOString();
}
function finDelDia(d: Date): string {
  const x = new Date(d); x.setHours(23, 59, 59, 999); return x.toISOString();
}

const ETIQUETA_SYNC: Record<VentaConsulta["sync"], string> = {
  SINCRONIZADA: "● En el ERP",
  PENDIENTE: "◐ Subiendo",
  ERROR: "✕ No llegó al ERP",
};

/**
 * Consulta de tickets ya realizados, con su detalle y la cancelación lógica.
 *
 * Cancelar exige el PIN de un gerente y NUNCA borra: la venta queda como CANCELADA con motivo,
 * quién la pidió y quién la autorizó. El corte de caja solo suma ventas cobradas, así que al
 * cancelar baja el efectivo esperado exactamente en ese importe — que es lo que pasa en el cajón
 * al devolver el dinero.
 */
export function PosConsultarVentasScreen({ onCerrar }: { onCerrar: () => void }) {
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const { usuario } = useAuthLocalStore();

  const [rango, setRango] = useState<RangoRapido>("hoy");
  const [folio, setFolio] = useState("");
  const [cajeroId, setCajeroId] = useState<string | null>(null);
  const [estado, setEstado] = useState<string | null>(null);
  const [ventas, setVentas] = useState<VentaConsulta[]>([]);
  const [cajeros, setCajeros] = useState<CajeroDelRango[]>([]);
  const [cargando, setCargando] = useState(true);

  const [detalle, setDetalle] = useState<{ venta: VentaConsulta; lineas: LineaTicket[] } | null>(null);
  const [cancelando, setCancelando] = useState<VentaConsulta | null>(null);
  const [motivo, setMotivo] = useState("");
  const [pidiendoPin, setPidiendoPin] = useState(false);

  const filtro: FiltroConsulta = useMemo(() => {
    const ahora = new Date();
    const dias = rango === "hoy" ? 0 : rango === "7dias" ? 6 : 29;
    return {
      desde: inicioDelDia(new Date(ahora.getTime() - dias * 86_400_000)),
      hasta: finDelDia(ahora),
      usuarioId: cajeroId,
      estado,
      folio,
    };
  }, [rango, cajeroId, estado, folio]);

  async function cargar() {
    const db = await abrirBaseDeDatos();
    const [lista, cajerosRango] = await Promise.all([
      consultarVentas(db, filtro),
      cajerosDelRango(db, filtro.desde!, filtro.hasta!),
    ]);
    setVentas(lista);
    setCajeros(cajerosRango);
    setCargando(false);
  }

  useEffect(() => {
    cargar();
  }, [filtro]); // eslint-disable-line react-hooks/exhaustive-deps

  async function abrirDetalle(venta: VentaConsulta) {
    const db = await abrirBaseDeDatos();
    setDetalle({ venta, lineas: await detalleTicket(db, venta.id) });
  }

  function pedirCancelacion(venta: VentaConsulta) {
    if (venta.estado === "CANCELADA") return;
    setCancelando(venta);
    setMotivo("");
  }

  async function ejecutarCancelacion(autorizador: Autorizador) {
    if (!cancelando || !usuario) return;
    setPidiendoPin(false);
    try {
      const db = await abrirBaseDeDatos();
      await cancelarVenta(db, {
        ventaId: cancelando.id,
        motivo: motivo.trim(),
        solicitadaPorId: usuario.id,
        autorizadaPorId: autorizador.id,
        autorizadaPorNombre: autorizador.nombre,
      });
      setCancelando(null);
      setDetalle(null);
      await cargar();
      // Se intenta subir de inmediato: la cancelación es justo lo que el gerente quiere ver
      // reflejado arriba cuanto antes.
      procesarCola(true).catch(() => undefined);
      Alert.alert("Ticket cancelado", `Folio #${cancelando.folioLocal} cancelado y autorizado por ${autorizador.nombre}.`);
    } catch (e: any) {
      Alert.alert("Cancelar", e?.message ?? "No se pudo cancelar el ticket.");
    }
  }

  const totalMostrado = ventas.filter((v) => v.estado !== "CANCELADA").reduce((s, v) => s + v.total, 0);

  if (cargando) {
    return <View style={estilos.centro}><ActivityIndicator color={colores.navy} size="large" /></View>;
  }

  return (
    <View style={{ flex: 1, backgroundColor: colores.fondo }}>
      <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
        <View style={estilos.encabezado}>
          <Text style={estilos.titulo}>Consultar ventas</Text>
          <TouchableOpacity onPress={onCerrar}><Text style={estilos.cerrar}>✕</Text></TouchableOpacity>
        </View>

        <View style={estilos.chips}>
          {([["hoy", "Hoy"], ["7dias", "7 días"], ["30dias", "30 días"]] as [RangoRapido, string][]).map(([id, etiqueta]) => (
            <TouchableOpacity key={id} onPress={() => setRango(id)} style={[estilos.chip, rango === id && estilos.chipActivo]}>
              <Text style={[estilos.chipTexto, rango === id && estilos.chipTextoActivo]}>{etiqueta}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TextInput
          value={folio}
          onChangeText={setFolio}
          placeholder="Buscar por folio…"
          placeholderTextColor={colores.textoSecundario}
          keyboardType="number-pad"
          style={estilos.input}
        />

        <View style={estilos.chips}>
          <TouchableOpacity onPress={() => setEstado(null)} style={[estilos.chip, !estado && estilos.chipActivo]}>
            <Text style={[estilos.chipTexto, !estado && estilos.chipTextoActivo]}>Todas</Text>
          </TouchableOpacity>
          {[["COBRADA", "Cobradas"], ["CANCELADA", "Canceladas"]].map(([v, e]) => (
            <TouchableOpacity key={v} onPress={() => setEstado(v)} style={[estilos.chip, estado === v && estilos.chipActivo]}>
              <Text style={[estilos.chipTexto, estado === v && estilos.chipTextoActivo]}>{e}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {cajeros.length > 1 && (
          <View style={estilos.chips}>
            <TouchableOpacity onPress={() => setCajeroId(null)} style={[estilos.chip, !cajeroId && estilos.chipActivo]}>
              <Text style={[estilos.chipTexto, !cajeroId && estilos.chipTextoActivo]}>Todos</Text>
            </TouchableOpacity>
            {cajeros.map((c) => (
              <TouchableOpacity key={c.usuarioId} onPress={() => setCajeroId(c.usuarioId)} style={[estilos.chip, cajeroId === c.usuarioId && estilos.chipActivo]}>
                <Text style={[estilos.chipTexto, cajeroId === c.usuarioId && estilos.chipTextoActivo]}>{c.nombre}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={estilos.resumen}>
          <Text style={estilos.resumenTexto}>{ventas.length} ticket(s)</Text>
          <Text style={estilos.resumenTexto}>{formatearDinero(totalMostrado)}</Text>
        </View>

        {ventas.length === 0 && <Text style={estilos.ayuda}>Sin tickets con estos filtros.</Text>}

        {ventas.map((v) => {
          const cancelada = v.estado === "CANCELADA";
          return (
            <TouchableOpacity
              key={v.id}
              onPress={() => abrirDetalle(v)}
              style={[estilos.fila, cancelada && { opacity: 0.6, borderLeftColor: colores.red }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[estilos.folio, cancelada && { textDecorationLine: "line-through" }]}>
                  #{v.folioLocal} · {formatearFechaHora(v.createdAt)}
                </Text>
                <Text style={estilos.ayuda} numberOfLines={1}>
                  {v.cajero} · {v.articulos} art. · {v.metodos}
                </Text>
                <Text style={[estilos.ayuda, { color: v.sync === "ERROR" ? colores.red : colores.textoSecundario }]}>
                  {ETIQUETA_SYNC[v.sync]}{cancelada ? " · CANCELADA" : ""}
                </Text>
              </View>
              <Text style={[estilos.total, cancelada && { textDecorationLine: "line-through" }]}>
                {formatearDinero(v.total)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Detalle del ticket */}
      {detalle && (
        <Modal visible animationType="slide" transparent onRequestClose={() => setDetalle(null)}>
          <View style={estilos.fondoModal}>
            <View style={estilos.hoja}>
              <View style={estilos.encabezado}>
                <Text style={estilos.titulo}>Ticket #{detalle.venta.folioLocal}</Text>
                <TouchableOpacity onPress={() => setDetalle(null)}><Text style={estilos.cerrar}>✕</Text></TouchableOpacity>
              </View>
              <Text style={estilos.ayuda}>
                {formatearFechaHora(detalle.venta.createdAt)} · {detalle.venta.cajero} · {detalle.venta.metodos}
              </Text>

              {detalle.venta.estado === "CANCELADA" && (
                <View style={estilos.avisoCancelada}>
                  <Text style={estilos.textoCancelada}>
                    CANCELADA{detalle.venta.canceladaAt ? ` el ${formatearFechaHora(detalle.venta.canceladaAt)}` : ""}
                  </Text>
                  <Text style={estilos.ayuda}>Motivo: {detalle.venta.canceladaMotivo || "—"}</Text>
                  <Text style={estilos.ayuda}>Autorizó: {detalle.venta.canceladaPorNombre || "—"}</Text>
                </View>
              )}

              <ScrollView style={{ maxHeight: 280, marginTop: 10 }}>
                {detalle.lineas.map((l, i) => (
                  <View key={i} style={estilos.lineaTicket}>
                    <View style={{ flex: 1 }}>
                      <Text style={estilos.nombreLinea}>{l.cantidad}× {l.nombre}</Text>
                      {l.modificadores.length > 0 && <Text style={estilos.ayuda}>{l.modificadores.join(" · ")}</Text>}
                      {l.notas ? <Text style={estilos.ayuda}>✎ {l.notas}</Text> : null}
                    </View>
                    <Text style={estilos.total}>{formatearDinero(l.precioUnitario * l.cantidad)}</Text>
                  </View>
                ))}
              </ScrollView>

              <View style={estilos.filaTotal}>
                <Text style={estilos.titulo}>Total</Text>
                <Text style={estilos.titulo}>{formatearDinero(detalle.venta.total)}</Text>
              </View>

              {detalle.venta.estado !== "CANCELADA" && (
                <TouchableOpacity onPress={() => { const v = detalle.venta; setDetalle(null); pedirCancelacion(v); }} style={estilos.botonCancelarTicket}>
                  <Text style={estilos.botonCancelarTicketTexto}>Cancelar este ticket</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </Modal>
      )}

      {/* Motivo de la cancelación — obligatorio: sin motivo la auditoría no sirve de nada. */}
      {cancelando && !pidiendoPin && (
        <Modal visible animationType="slide" transparent onRequestClose={() => setCancelando(null)}>
          <View style={estilos.fondoModal}>
            <View style={estilos.hoja}>
              <View style={estilos.encabezado}>
                <Text style={estilos.titulo}>Cancelar #{cancelando.folioLocal}</Text>
                <TouchableOpacity onPress={() => setCancelando(null)}><Text style={estilos.cerrar}>✕</Text></TouchableOpacity>
              </View>
              <Text style={estilos.ayuda}>
                El ticket no se borra: queda registrado como cancelado, con el motivo y quién lo
                autorizó. El importe deja de contar en el corte de caja y en los reportes.
              </Text>
              <TextInput
                value={motivo}
                onChangeText={setMotivo}
                placeholder="Motivo (obligatorio): error de cobro, cliente devolvió…"
                placeholderTextColor={colores.textoSecundario}
                multiline
                style={[estilos.input, { minHeight: 80, textAlignVertical: "top", marginTop: 12 }]}
              />
              <TouchableOpacity
                onPress={() => setPidiendoPin(true)}
                disabled={motivo.trim().length < 4}
                style={[estilos.botonCancelarTicket, motivo.trim().length < 4 && { opacity: 0.5 }]}
              >
                <Text style={estilos.botonCancelarTicketTexto}>Continuar — pedir autorización</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      {cancelando && pidiendoPin && usuario && (
        <ModalAutorizacion
          titulo={`Autorizar cancelación #${cancelando.folioLocal}`}
          descripcion={`Se cancelará el ticket por ${formatearDinero(cancelando.total)}. Hace falta el PIN de un supervisor o administrador.`}
          solicitanteId={usuario.id}
          onCancelar={() => setPidiendoPin(false)}
          onAutorizado={ejecutarCancelacion}
        />
      )}
    </View>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    centro: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colores.fondo },
    encabezado: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
    titulo: { fontSize: 19, fontWeight: "800", color: colores.texto },
    cerrar: { color: colores.textoSecundario, fontSize: 20 },
    ayuda: { fontSize: 12, color: colores.textoSecundario, lineHeight: 17 },
    input: { borderWidth: 1, borderColor: colores.borde, borderRadius: 8, padding: 12, minHeight: 44, color: colores.texto, marginBottom: 10 },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 },
    chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 8, backgroundColor: colores.gray50, minHeight: 40, justifyContent: "center" },
    chipActivo: { backgroundColor: colores.navy },
    chipTexto: { fontSize: 13, fontWeight: "600", color: colores.texto },
    chipTextoActivo: { color: "#fff" },
    resumen: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colores.borde, marginBottom: 8 },
    resumenTexto: { fontSize: 14, fontWeight: "800", color: colores.texto },
    fila: {
      flexDirection: "row", alignItems: "center", gap: 10, padding: 12, marginBottom: 8,
      backgroundColor: colores.superficie, borderRadius: 10, borderLeftWidth: 4, borderLeftColor: colores.green,
    },
    folio: { fontSize: 14, fontWeight: "700", color: colores.texto },
    total: { fontSize: 15, fontWeight: "800", color: colores.navyTexto },
    fondoModal: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
    hoja: { backgroundColor: colores.fondo, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, maxHeight: "88%" },
    lineaTicket: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colores.borde },
    nombreLinea: { fontSize: 14, fontWeight: "600", color: colores.texto },
    filaTotal: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 12 },
    avisoCancelada: { backgroundColor: colores.gray50, borderRadius: 8, padding: 10, marginTop: 10, borderLeftWidth: 4, borderLeftColor: colores.red },
    textoCancelada: { fontSize: 13, fontWeight: "800", color: colores.red, marginBottom: 4 },
    botonCancelarTicket: { backgroundColor: colores.red, borderRadius: 10, padding: 15, alignItems: "center", minHeight: 50, justifyContent: "center", marginTop: 12 },
    botonCancelarTicketTexto: { color: "#fff", fontWeight: "800", fontSize: 15 },
  });
}
