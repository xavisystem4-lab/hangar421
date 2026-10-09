import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { usarColores } from "../store/temaStore";
import { useAuthLocalStore } from "../store/authLocalStore";
import { abrirBaseDeDatos } from "../db/database";
import { consultarVentas, detalleTicket, ventaParaReabrir, type FiltroConsulta, type LineaTicket, type VentaConsulta } from "../db/ventasHistorialRepo";
import { cambiarMetodoPago, cancelarVenta, pagosDeVenta, type PagoVenta } from "../db/ventasRepo";
import { etiquetaMetodoPago, listarMetodosPago } from "../db/metodosPagoRepo";
import { useCarritoStore } from "../store/carritoStore";
import { MetodoPago } from "@hangar421/shared";
import { cajerosDelRango, type CajeroDelRango } from "../db/reportesRepo";
import { procesarCola } from "../sync/syncEngine";
import { ModalAutorizacion } from "../components/ModalAutorizacion";
import { formatearDinero, formatearFechaHora } from "../reportes/armarReporte";
import type { Autorizador } from "../auth/autorizacion";
import { PERMISOS_TERMINAL, tienePermiso } from "../auth/permisosTerminal";
import { imprimirTicket } from "../printing/imprimirTicket";

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
/** Métodos a los que se puede cambiar un cobro ya hecho. Dólares y crédito de empleado quedan
 *  fuera: los dólares necesitan tipo de cambio y monto recibido (eso es volver a cobrar) y el
 *  crédito mueve el monedero de la empleada. */
const METODOS_CAMBIABLES: MetodoPago[] = [MetodoPago.EFECTIVO, MetodoPago.TARJETA, MetodoPago.TRANSFERENCIA, MetodoPago.QR, MetodoPago.EN_LINEA, MetodoPago.OTRO];

export function PosConsultarVentasScreen({ onCerrar, onReabierta }: { onCerrar: () => void; onReabierta?: () => void }) {
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const { usuario } = useAuthLocalStore();
  const carrito = useCarritoStore();

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

  // Cambio de método de pago de una venta cobrada (efectivo ↔ tarjeta…): se elige el método,
  // se pide el PIN de un supervisor y se reemplazan los pagos (local + ERP).
  const [cambiandoPago, setCambiandoPago] = useState<{ venta: VentaConsulta; actuales: PagoVenta[]; opciones: MetodoPago[] } | null>(null);
  const [metodoNuevo, setMetodoNuevo] = useState<MetodoPago | null>(null);
  const [referenciaNueva, setReferenciaNueva] = useState("");
  const [pinCambioPago, setPinCambioPago] = useState(false);
  // Reabrir = cancelar este ticket y pasar sus productos al carrito para corregir y cobrar de
  // nuevo (folio nuevo). También con PIN de supervisor: por debajo es una cancelación.
  const [reabriendo, setReabriendo] = useState<VentaConsulta | null>(null);

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

  async function pedirCambioPago(venta: VentaConsulta) {
    const db = await abrirBaseDeDatos();
    const [actuales, habilitados] = await Promise.all([pagosDeVenta(db, venta.id), listarMetodosPago(db, true)]);
    if (actuales.some((p) => p.metodo === MetodoPago.MONEDERO_EMPLEADO)) {
      Alert.alert("Cambiar método de pago", "Esta venta se pagó con crédito de empleado: para corregirla cancélala y vuelve a cobrarla.");
      return;
    }
    const metodoActual = actuales.length === 1 ? actuales[0].metodo : null;
    const opciones = habilitados.map((m) => m.tipo).filter((m) => METODOS_CAMBIABLES.includes(m) && m !== metodoActual);
    if (opciones.length === 0) {
      Alert.alert("Cambiar método de pago", "No hay otro método de pago habilitado. Actívalo en Admin → Pagos.");
      return;
    }
    setDetalle(null);
    setMetodoNuevo(null);
    setReferenciaNueva("");
    setCambiandoPago({ venta, actuales, opciones });
  }

  async function ejecutarCambioPago(autorizador: Autorizador) {
    if (!cambiandoPago || !metodoNuevo || !usuario) return;
    setPinCambioPago(false);
    const { venta } = cambiandoPago;
    try {
      const db = await abrirBaseDeDatos();
      await cambiarMetodoPago(db, {
        ventaId: venta.id,
        pagos: [{ metodo: metodoNuevo, monto: venta.total, referencia: referenciaNueva.trim() || undefined }],
        solicitadaPorId: usuario.id,
        autorizadaPorId: autorizador.id,
        autorizadaPorNombre: autorizador.nombre,
        motivo: `Antes: ${cambiandoPago.actuales.map((p) => etiquetaMetodoPago[p.metodo as MetodoPago] ?? p.metodo).join(" + ")}`,
      });
      setCambiandoPago(null);
      await cargar();
      procesarCola(true).catch(() => undefined);
      Alert.alert("Método de pago cambiado", `Folio #${venta.folioLocal} ahora está cobrado con ${etiquetaMetodoPago[metodoNuevo]}. El corte de caja ya lo refleja.`);
    } catch (e: any) {
      Alert.alert("Cambiar método de pago", e?.message ?? "No se pudo cambiar el método de pago.");
    }
  }

  function pedirReapertura(venta: VentaConsulta) {
    if (carrito.items.length > 0) {
      Alert.alert("Hay una venta en curso", "Cobra o vacía la venta actual antes de reabrir un ticket.");
      return;
    }
    setDetalle(null);
    Alert.alert(
      `Reabrir ticket #${venta.folioLocal}`,
      "El ticket se cancela y sus productos pasan a la pantalla de Venta para corregirlos y cobrarlos de nuevo con un folio nuevo. Hace falta el PIN de un supervisor.",
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Reabrir", onPress: () => setReabriendo(venta) },
      ],
    );
  }

  async function ejecutarReapertura(autorizador: Autorizador) {
    if (!reabriendo || !usuario) return;
    const venta = reabriendo;
    setReabriendo(null);
    try {
      const db = await abrirBaseDeDatos();
      const datos = await ventaParaReabrir(db, venta.id);
      if (datos.items.length === 0) throw new Error("El ticket no tiene productos que reabrir.");
      await cancelarVenta(db, {
        ventaId: venta.id,
        motivo: `Reabierta para corrección (se cobra de nuevo con folio nuevo)`,
        solicitadaPorId: usuario.id,
        autorizadaPorId: autorizador.id,
        autorizadaPorNombre: autorizador.nombre,
      });
      carrito.limpiar();
      for (const item of datos.items) carrito.agregarItem(item);
      if (datos.nombreCliente) carrito.fijarNombreCliente(datos.nombreCliente);
      await cargar();
      procesarCola(true).catch(() => undefined);
      onReabierta?.();
    } catch (e: any) {
      Alert.alert("Reabrir ticket", e?.message ?? "No se pudo reabrir el ticket.");
    }
  }

  /** Para el cliente que al final sí quiere su ticket. Imprime el mismo ticket de la venta
   *  (mismo folio y datos), no uno nuevo. */
  const [imprimiendo, setImprimiendo] = useState(false);
  async function reimprimir(venta: VentaConsulta) {
    setImprimiendo(true);
    try {
      const db = await abrirBaseDeDatos();
      const r = await imprimirTicket(db, venta.id);
      if (!r.impreso) Alert.alert("No se imprimió", r.motivo ?? "Inténtalo de nuevo.");
    } finally {
      setImprimiendo(false);
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
                <TouchableOpacity onPress={() => reimprimir(detalle.venta)} disabled={imprimiendo} style={estilos.botonReimprimir}>
                  {imprimiendo
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={estilos.botonCancelarTicketTexto}>🖨 Reimprimir ticket</Text>}
                </TouchableOpacity>
              )}

              {/* Correcciones de una venta cobrada: cambiar el método de pago o reabrirla. Las dos
                  piden el PIN de un supervisor (mueven el corte / cancelan el ticket). */}
              {detalle.venta.estado === "COBRADA" && tienePermiso(usuario, PERMISOS_TERMINAL.VENTA_COBRAR) && (
                <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                  <TouchableOpacity onPress={() => pedirCambioPago(detalle.venta)} style={[estilos.botonSecundario, { flex: 1 }]}>
                    <Text style={estilos.botonSecundarioTexto}>💳 Cambiar método de pago</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => pedirReapertura(detalle.venta)} style={[estilos.botonSecundario, { flex: 1 }]}>
                    <Text style={estilos.botonSecundarioTexto}>↩ Reabrir cuenta</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Sin el permiso no se ofrece; con él, igual pide el PIN de un supervisor. */}
              {detalle.venta.estado !== "CANCELADA" && tienePermiso(usuario, PERMISOS_TERMINAL.VENTA_CANCELAR) && (
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

      {/* Cambio de método de pago: elegir el método nuevo (un solo pago por el total). */}
      {cambiandoPago && !pinCambioPago && (
        <Modal visible animationType="slide" transparent onRequestClose={() => setCambiandoPago(null)}>
          <View style={estilos.fondoModal}>
            <View style={estilos.hoja}>
              <View style={estilos.encabezado}>
                <Text style={estilos.titulo}>Cambiar método de pago · #{cambiandoPago.venta.folioLocal}</Text>
                <TouchableOpacity onPress={() => setCambiandoPago(null)}><Text style={estilos.cerrar}>✕</Text></TouchableOpacity>
              </View>
              <Text style={estilos.ayuda}>
                Cobrado con {cambiandoPago.actuales.map((p) => `${etiquetaMetodoPago[p.metodo as MetodoPago] ?? p.metodo} ${formatearDinero(p.monto)}`).join(" + ")}.
                El total ({formatearDinero(cambiandoPago.venta.total)}) no cambia; solo cómo se pagó. El corte de caja se ajusta solo.
              </Text>
              <View style={[estilos.chips, { marginTop: 12 }]}>
                {cambiandoPago.opciones.map((m) => (
                  <TouchableOpacity key={m} onPress={() => setMetodoNuevo(m)} style={[estilos.chip, metodoNuevo === m && estilos.chipActivo]}>
                    <Text style={[estilos.chipTexto, metodoNuevo === m && estilos.chipTextoActivo]}>{etiquetaMetodoPago[m]}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {metodoNuevo && metodoNuevo !== MetodoPago.EFECTIVO && (
                <TextInput
                  value={referenciaNueva}
                  onChangeText={setReferenciaNueva}
                  placeholder={metodoNuevo === MetodoPago.TARJETA ? "Autorización o últimos 4 dígitos (opcional)" : "Referencia (opcional)"}
                  placeholderTextColor={colores.textoSecundario}
                  style={estilos.input}
                />
              )}
              <TouchableOpacity
                onPress={() => setPinCambioPago(true)}
                disabled={!metodoNuevo}
                style={[estilos.botonReimprimir, !metodoNuevo && { opacity: 0.5 }]}
              >
                <Text style={estilos.botonCancelarTicketTexto}>Continuar — pedir autorización</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      {cambiandoPago && pinCambioPago && usuario && metodoNuevo && (
        <ModalAutorizacion
          titulo={`Autorizar cambio de pago #${cambiandoPago.venta.folioLocal}`}
          descripcion={`El ticket por ${formatearDinero(cambiandoPago.venta.total)} pasará a ${etiquetaMetodoPago[metodoNuevo]}. Hace falta el PIN de un supervisor o administrador.`}
          solicitanteId={usuario.id}
          onCancelar={() => setPinCambioPago(false)}
          onAutorizado={ejecutarCambioPago}
        />
      )}

      {reabriendo && usuario && (
        <ModalAutorizacion
          titulo={`Autorizar reapertura #${reabriendo.folioLocal}`}
          descripcion={`El ticket por ${formatearDinero(reabriendo.total)} se cancelará y sus productos pasarán a Venta para cobrarse de nuevo. Hace falta el PIN de un supervisor o administrador.`}
          solicitanteId={usuario.id}
          onCancelar={() => setReabriendo(null)}
          onAutorizado={ejecutarReapertura}
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
    botonReimprimir: { backgroundColor: colores.navy, borderRadius: 10, padding: 15, alignItems: "center", minHeight: 50, justifyContent: "center", marginTop: 12 },
    botonSecundario: { backgroundColor: colores.gray50, borderWidth: 1, borderColor: colores.borde, borderRadius: 10, padding: 12, alignItems: "center", minHeight: 50, justifyContent: "center" },
    botonSecundarioTexto: { color: colores.texto, fontWeight: "800", fontSize: 14, textAlign: "center" },
  });
}
