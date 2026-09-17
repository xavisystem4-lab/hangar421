import { useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { MetodoPago } from "@hangar421/shared";
import { usePosOrderStore } from "../../store/posOrderStore";
import { useAuthStore } from "../../store/authStore";
import { usarColores } from "../../store/temaStore";
import { PosModalDescuento } from "./PosModalDescuento";

// TARJETA se agrega en la Fase 1b (terminal Mercado Pago) — requiere una PaymentTerminal ya
// configurada y un lector físico, no verificable en este entorno. Por ahora solo métodos con
// monto manual, igual que ModalCobro.tsx (POS Windows) para Efectivo/Transferencia/QR.
const METODOS: { valor: MetodoPago; etiqueta: string; icono: string }[] = [
  { valor: MetodoPago.EFECTIVO, etiqueta: "Efectivo", icono: "💵" },
  { valor: MetodoPago.TRANSFERENCIA, etiqueta: "Transferencia", icono: "🏦" },
  { valor: MetodoPago.QR, etiqueta: "QR", icono: "▦" },
];

const PROPINAS_RAPIDAS = [10, 15, 20];
const TECLAS = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "0", ".", "borrar"];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Pantalla completa de cobro — equivalente a `ModalCobro.tsx` del POS Windows (sin la parte de
 *  terminal de tarjeta, ver Fase 1b): método de pago, propina, descuento, pagos divididos/mixtos
 *  con teclado numérico en pantalla, y confirmar. Si el pedido todavía no existe en el servidor
 *  (se armó aquí mismo, no viene de "Por cobrar"), lo crea al confirmar — mismo criterio que el
 *  POS de escritorio: "pagar" es lo que manda el pedido, no hay un paso separado. */
export function PosCobroScreen({ nombreCuenta, onCerrar, onCobrado }: { nombreCuenta: string | null; onCerrar: () => void; onCobrado: () => void }) {
  const { items, totales, descuentos, pedidoId, enviarACocina, cobrar } = usePosOrderStore();
  const sucursalId = useAuthStore((s) => s.sucursalId)!;
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const t = totales();
  const [mostrarDescuento, setMostrarDescuento] = useState(false);
  const [metodoActivo, setMetodoActivo] = useState<MetodoPago>(MetodoPago.EFECTIVO);

  const [propinaPorcentaje, setPropinaPorcentaje] = useState(0);
  const [propinaMontoTexto, setPropinaMontoTexto] = useState("");
  const propina = propinaMontoTexto !== "" ? Number(propinaMontoTexto) || 0 : round2(t.total * (propinaPorcentaje / 100));
  const totalAPagar = round2(t.total + propina);

  const [pagos, setPagos] = useState<{ metodo: MetodoPago; monto: number }[]>([]);
  const [montoInput, setMontoInput] = useState("0");
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pagadoHasta = pagos.reduce((s, p) => s + p.monto, 0);
  const totalConTeclaActual = pagadoHasta + Number(montoInput || 0);
  const restante = Math.max(0, totalAPagar - totalConTeclaActual);
  const cambio = Math.max(0, totalConTeclaActual - totalAPagar);

  function elegirMetodo(metodo: MetodoPago) {
    setMetodoActivo(metodo);
    const faltante = round2(Math.max(0, totalAPagar - pagadoHasta));
    setMontoInput(metodo === MetodoPago.EFECTIVO ? "0" : faltante > 0 ? faltante.toFixed(2) : "0");
  }

  function presionarTecla(tecla: string) {
    setMontoInput((m) => {
      if (tecla === "borrar") return m.length > 1 ? m.slice(0, -1) : "0";
      if (tecla === ".") return m.includes(".") ? m : `${m}.`;
      return m === "0" ? tecla : m + tecla;
    });
  }

  function agregarPago() {
    const monto = Number(montoInput);
    if (!monto || monto <= 0) return;
    setPagos((p) => [...p, { metodo: metodoActivo, monto }]);
    setMontoInput(restante.toFixed(2));
  }

  function quitarPago(i: number) {
    setPagos((p) => p.filter((_, idx) => idx !== i));
  }

  function elegirPropinaRapida(pct: number) {
    setPropinaPorcentaje(pct);
    setPropinaMontoTexto("");
  }

  async function confirmar() {
    setError(null);
    const pagosFinales = pagos.length > 0 ? pagos : [{ metodo: metodoActivo, monto: Number(montoInput) }];
    if (pagosFinales.reduce((s, p) => s + p.monto, 0) < totalAPagar - 0.01) {
      setError("El total pagado no cubre el importe a pagar");
      return;
    }
    setProcesando(true);
    try {
      if (!pedidoId) await enviarACocina();
      await cobrar(pagosFinales);
      onCobrado();
    } catch (e: any) {
      setError(e.message ?? "No se pudo procesar el cobro");
    } finally {
      setProcesando(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colores.fondo }}>
      <View style={estilos.encabezado}>
        <Text style={estilos.encabezadoTitulo}>Cobrar · {nombreCuenta ?? "Mostrador"}</Text>
        <TouchableOpacity onPress={onCerrar}><Text style={estilos.cerrar}>✕</Text></TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16 }}>
        {items.map((item) => (
          <View key={item.id} style={estilos.filaItem}>
            <Text style={{ color: colores.texto }}>{item.cantidad}× {item.nombreProducto}</Text>
            <Text style={{ color: colores.texto }}>${((item.precioUnitario + item.modificadores.reduce((s, m) => s + m.precioExtra, 0)) * item.cantidad).toFixed(2)}</Text>
          </View>
        ))}

        <View style={estilos.totalesBox}>
          <View style={estilos.filaTotal}><Text style={estilos.textoNavy}>Subtotal</Text><Text style={estilos.textoNavy}>${t.subtotal.toFixed(2)}</Text></View>
          {t.descuentoTotal > 0 && (
            <View style={estilos.filaTotal}><Text style={estilos.textoNavy}>Descuento</Text><Text style={estilos.textoNavy}>−${t.descuentoTotal.toFixed(2)}</Text></View>
          )}
          <View style={estilos.filaTotal}><Text style={estilos.totalGrande}>Total</Text><Text style={estilos.totalGrande}>${t.total.toFixed(2)}</Text></View>
        </View>

        <Text style={estilos.subtitulo}>Método de pago</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {METODOS.map((m) => (
            <TouchableOpacity key={m.valor} onPress={() => elegirMetodo(m.valor)} style={[estilos.botonChip, metodoActivo === m.valor && estilos.botonChipActivo]}>
              <Text style={{ color: metodoActivo === m.valor ? "#fff" : colores.texto }}>{m.icono} {m.etiqueta}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={estilos.subtitulo}>Propina</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <TouchableOpacity onPress={() => elegirPropinaRapida(0)} style={[estilos.botonChip, propina === 0 && estilos.botonChipActivo]}>
            <Text style={{ color: propina === 0 ? "#fff" : colores.texto }}>Sin propina</Text>
          </TouchableOpacity>
          {PROPINAS_RAPIDAS.map((pct) => (
            <TouchableOpacity key={pct} onPress={() => elegirPropinaRapida(pct)} style={[estilos.botonChip, propinaMontoTexto === "" && propinaPorcentaje === pct && estilos.botonChipActivo]}>
              <Text style={{ color: propinaMontoTexto === "" && propinaPorcentaje === pct ? "#fff" : colores.texto }}>{pct}%</Text>
            </TouchableOpacity>
          ))}
          <TextInput
            placeholder="Importe $"
            placeholderTextColor={colores.textoSecundario}
            value={propinaMontoTexto}
            onChangeText={setPropinaMontoTexto}
            keyboardType="decimal-pad"
            style={estilos.inputPropina}
          />
        </View>

        <View style={estilos.filaDescuento}>
          <Text style={estilos.textoNavy}>
            {t.descuentoTotal > 0 ? `Descuento aplicado: −$${t.descuentoTotal.toFixed(2)}` : "Sin descuento aplicado."}
          </Text>
          <TouchableOpacity onPress={() => setMostrarDescuento(true)} style={estilos.botonDescuento}>
            <Text style={{ fontSize: 13, color: "#000" }}>{t.descuentoTotal > 0 ? "Cambiar" : "% Descuento"}</Text>
          </TouchableOpacity>
        </View>

        {pagos.length > 0 && (
          <View style={{ marginTop: 12 }}>
            {pagos.map((p, i) => (
              <View key={i} style={estilos.filaTotal}>
                <Text style={{ color: colores.texto }}>{METODOS.find((m) => m.valor === p.metodo)?.etiqueta ?? p.metodo}</Text>
                <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                  <Text style={{ color: colores.texto }}>${p.monto.toFixed(2)}</Text>
                  <TouchableOpacity onPress={() => quitarPago(i)}><Text style={{ color: colores.red }}>🗑</Text></TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={estilos.totalesBox}>
          <View style={estilos.filaTotal}><Text style={estilos.textoNavy}>Propina</Text><Text style={estilos.textoNavy}>${propina.toFixed(2)}</Text></View>
          <View style={estilos.filaTotal}><Text style={estilos.totalGrande}>Total a pagar</Text><Text style={estilos.totalGrande}>${totalAPagar.toFixed(2)}</Text></View>
          <Text style={[estilos.totalGrande, { color: restante > 0 ? colores.navyTexto : colores.green, marginTop: 6 }]}>
            {restante > 0 ? `Falta cubrir: $${restante.toFixed(2)}` : `Cambio: $${cambio.toFixed(2)}`}
          </Text>
        </View>

        <View style={estilos.tecladoContenedor}>
          <Text style={estilos.montoIngresado}>${montoInput}</Text>
          <View style={estilos.teclado}>
            {TECLAS.map((k) => (
              <TouchableOpacity key={k} onPress={() => presionarTecla(k)} style={[estilos.tecla, k === "borrar" && estilos.teclaBorrar]}>
                <Text style={{ fontSize: 20, fontWeight: "700", color: k === "borrar" ? colores.red : colores.texto }}>{k === "borrar" ? "⌫" : k}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity onPress={agregarPago} style={estilos.botonAgregarPago}>
            <Text style={{ color: "#fff", fontWeight: "700" }}>Agregar pago</Text>
          </TouchableOpacity>
        </View>

        {error && <Text style={estilos.error}>{error}</Text>}

        <View style={{ flexDirection: "row", gap: 10, marginTop: 16, marginBottom: 30 }}>
          <TouchableOpacity onPress={onCerrar} style={[estilos.botonAccion, { backgroundColor: colores.gray200 }]}>
            <Text style={{ color: colores.texto }}>Cancelar</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={confirmar} disabled={procesando} style={[estilos.botonAccion, { flex: 2, backgroundColor: colores.green }]}>
            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16 }}>{procesando ? "Procesando…" : "Confirmar pago"}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {mostrarDescuento && <PosModalDescuento sucursalId={sucursalId} onCerrar={() => setMostrarDescuento(false)} />}
    </View>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    encabezado: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, backgroundColor: colores.navy },
    encabezadoTitulo: { color: "#fff", fontWeight: "800", fontSize: 16 },
    cerrar: { color: "#fff", fontSize: 20 },
    filaItem: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
    totalesBox: { borderTopWidth: 1, borderTopColor: colores.borde, marginTop: 10, paddingTop: 10 },
    filaTotal: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
    textoNavy: { color: colores.navyTexto, fontWeight: "700" },
    totalGrande: { color: colores.navyTexto, fontWeight: "800", fontSize: 18 },
    subtitulo: { fontWeight: "700", color: colores.texto, marginTop: 18, marginBottom: 8 },
    botonChip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: colores.gray50, borderWidth: 1, borderColor: colores.borde },
    botonChipActivo: { backgroundColor: colores.navy, borderColor: colores.navy },
    inputPropina: { borderWidth: 1, borderColor: colores.borde, borderRadius: 10, paddingHorizontal: 12, minWidth: 100, color: colores.texto },
    filaDescuento: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 16, gap: 10 },
    botonDescuento: { backgroundColor: "#F5A524", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
    tecladoContenedor: { marginTop: 20, backgroundColor: colores.gray50, borderRadius: 12, padding: 16 },
    montoIngresado: { fontSize: 30, fontWeight: "800", textAlign: "center", color: colores.texto, marginBottom: 12 },
    teclado: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    tecla: { width: "30%", aspectRatio: 1.6, backgroundColor: colores.superficie, borderRadius: 10, borderWidth: 1, borderColor: colores.borde, alignItems: "center", justifyContent: "center" },
    teclaBorrar: { backgroundColor: colores.red + "22" },
    botonAgregarPago: { backgroundColor: colores.navy, borderRadius: 10, padding: 14, alignItems: "center", marginTop: 12, minHeight: 48, justifyContent: "center" },
    error: { color: colores.red, marginTop: 12 },
    botonAccion: { flex: 1, padding: 16, borderRadius: 12, alignItems: "center", minHeight: 56, justifyContent: "center" },
  });
}
