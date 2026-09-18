import { useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { MetodoPago } from "@hangar421/shared";
import { useCarritoStore } from "../store/carritoStore";
import { useAuthLocalStore } from "../store/authLocalStore";
import { usarColores } from "../store/temaStore";
import { abrirBaseDeDatos } from "../db/database";
import { confirmarVenta } from "../db/ventasRepo";
import { turnoAbierto } from "../db/turnosRepo";

const METODOS: { valor: MetodoPago; etiqueta: string; icono: string }[] = [
  { valor: MetodoPago.EFECTIVO, etiqueta: "Efectivo", icono: "💵" },
  { valor: MetodoPago.TARJETA, etiqueta: "Tarjeta", icono: "💳" },
  { valor: MetodoPago.TRANSFERENCIA, etiqueta: "Transferencia", icono: "🏦" },
  { valor: MetodoPago.OTRO, etiqueta: "Otro", icono: "▦" },
];

const TECLAS = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "0", ".", "borrar"];

/** Cobro — nunca toca la red: la venta se escribe local primero SIEMPRE (a diferencia del
 *  Comandero, que intenta en línea primero contra una Estación LAN). La confirmación es
 *  irrevocable en cuanto `confirmarVenta` resuelve: la transacción SQLite ya es atómica por sí
 *  sola. La impresión (Fase 2e) queda deliberadamente FUERA de esta pantalla — nunca bloquea ni
 *  puede hacer fallar una venta ya confirmada. */
export function PosCobroScreen({ onCerrar, onCobrado }: { onCerrar: () => void; onCobrado: (folio: number, total: number) => void }) {
  const { items, totales, limpiar } = useCarritoStore();
  const { usuario } = useAuthLocalStore();
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const t = totales();

  const [metodoActivo, setMetodoActivo] = useState<MetodoPago>(MetodoPago.EFECTIVO);
  const [pagos, setPagos] = useState<{ metodo: MetodoPago; monto: number }[]>([]);
  const [montoInput, setMontoInput] = useState("0");
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pagadoHasta = pagos.reduce((s, p) => s + p.monto, 0);
  const totalConTeclaActual = pagadoHasta + Number(montoInput || 0);
  const restante = Math.max(0, t.total - totalConTeclaActual);
  const cambio = Math.max(0, totalConTeclaActual - t.total);

  function elegirMetodo(metodo: MetodoPago) {
    setMetodoActivo(metodo);
    const faltante = Math.max(0, t.total - pagadoHasta);
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

  async function confirmar() {
    if (!usuario) return;
    setError(null);
    const pagosFinales = pagos.length > 0 ? pagos : [{ metodo: metodoActivo, monto: Number(montoInput) }];
    setProcesando(true);
    try {
      const db = await abrirBaseDeDatos();
      const turno = await turnoAbierto(db);
      if (!turno) throw new Error("No hay un turno de caja abierto — abre caja antes de cobrar.");
      const venta = await confirmarVenta(db, { items, pagos: pagosFinales, totales: t, turnoId: turno.id, usuarioId: usuario.id });
      limpiar();
      onCobrado(venta.folioLocal, venta.total);
    } catch (e: any) {
      setError(e.message ?? "No se pudo procesar el cobro");
    } finally {
      setProcesando(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colores.fondo }}>
      <View style={estilos.encabezado}>
        <Text style={estilos.encabezadoTitulo}>Cobrar</Text>
        <TouchableOpacity onPress={onCerrar}><Text style={estilos.cerrar}>✕</Text></TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16 }}>
        {items.map((item) => (
          <View key={item.id} style={estilos.filaItem}>
            <Text style={{ color: colores.texto }}>{item.cantidad}× {item.nombreProducto}</Text>
            <Text style={{ color: colores.texto }}>${(item.precioUnitario * item.cantidad).toFixed(2)}</Text>
          </View>
        ))}

        <View style={estilos.totalesBox}>
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
          <Text style={[estilos.totalGrande, { color: restante > 0 ? colores.navyTexto : colores.green }]}>
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
    totalGrande: { color: colores.navyTexto, fontWeight: "800", fontSize: 18 },
    subtitulo: { fontWeight: "700", color: colores.texto, marginTop: 18, marginBottom: 8 },
    botonChip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: colores.gray50, borderWidth: 1, borderColor: colores.borde },
    botonChipActivo: { backgroundColor: colores.navy, borderColor: colores.navy },
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
