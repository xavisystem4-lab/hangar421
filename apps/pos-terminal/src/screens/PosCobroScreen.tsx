import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { MetodoPago } from "@hangar421/shared";
import { useCarritoStore } from "../store/carritoStore";
import { useAuthLocalStore } from "../store/authLocalStore";
import { usarColores } from "../store/temaStore";
import { abrirBaseDeDatos } from "../db/database";
import { confirmarVenta } from "../db/ventasRepo";
import { sincronizarPronto } from "../sync/syncEngine";
import { turnoAbierto } from "../db/turnosRepo";
import { listarMetodosPago, etiquetaMetodoPago } from "../db/metodosPagoRepo";
import { imprimirTicket } from "../printing/imprimirTicket";

const ICONO: Record<MetodoPago, string> = {
  [MetodoPago.EFECTIVO]: "💵",
  [MetodoPago.TARJETA]: "💳",
  [MetodoPago.TRANSFERENCIA]: "🏦",
  [MetodoPago.QR]: "▦",
  [MetodoPago.OTRO]: "•",
};

// Orden de calculadora/cajero: 1-2-3 arriba y la fila final punto-cero-borrar, con el
// cero centrado bajo el 8 — es donde lo busca el pulgar por costumbre. Antes empezaba en 7
// (orden de teclado numérico de PC), que en una tablet de mostrador obliga a mirar.
const TECLAS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "borrar"];

/** Cobro — nunca toca la red: la venta se escribe local primero SIEMPRE (a diferencia del
 *  Comandero, que intenta en línea primero contra una Estación LAN). La confirmación es
 *  irrevocable en cuanto `confirmarVenta` resuelve: la transacción SQLite ya es atómica por sí
 *  sola. La impresión (Fase 2e) queda deliberadamente FUERA de esta pantalla — nunca bloquea ni
 *  puede hacer fallar una venta ya confirmada. */
export function PosCobroScreen({ onCerrar, onCobrado }: { onCerrar: () => void; onCobrado: (ventaId: string, folio: number, total: number) => void }) {
  const { items, totales, limpiar } = useCarritoStore();
  const { usuario } = useAuthLocalStore();
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const t = totales();

  const [metodos, setMetodos] = useState<{ valor: MetodoPago; etiqueta: string; icono: string }[]>([]);
  const [metodoActivo, setMetodoActivo] = useState<MetodoPago>(MetodoPago.EFECTIVO);
  const [montoInput, setMontoInput] = useState("0");
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const db = await abrirBaseDeDatos();
      const habilitados = await listarMetodosPago(db, true);
      setMetodos(habilitados.map((m) => ({ valor: m.tipo, etiqueta: etiquetaMetodoPago[m.tipo], icono: ICONO[m.tipo] })));
      if (habilitados[0]) setMetodoActivo(habilitados[0].tipo);
    })();
  }, []);

  // El teclado ya no arma pagos parciales: es solo "con cuánto paga el cliente", para calcular el
  // cambio. Dejarlo en 0 significa pago exacto — ver `montoCobrado`.
  const recibido = Number(montoInput || 0);
  const montoCobrado = recibido > 0 ? recibido : t.total;
  const restante = Math.max(0, t.total - montoCobrado);
  const cambio = Math.max(0, montoCobrado - t.total);

  function elegirMetodo(metodo: MetodoPago) {
    setMetodoActivo(metodo);
    // En efectivo el cajero teclea con cuánto le pagan; en los demás métodos el importe es
    // siempre el total exacto, así que no hay nada que teclear.
    setMontoInput(metodo === MetodoPago.EFECTIVO ? "0" : t.total.toFixed(2));
  }

  function presionarTecla(tecla: string) {
    setMontoInput((m) => {
      if (tecla === "borrar") return m.length > 1 ? m.slice(0, -1) : "0";
      if (tecla === ".") return m.includes(".") ? m : `${m}.`;
      return m === "0" ? tecla : m + tecla;
    });
  }

  async function confirmar() {
    if (!usuario) return;
    setError(null);
    // Un solo pago con el método activo. Si el cajero no tecleó nada se cobra el total exacto:
    // es el caso mayoritario y ahorra teclear el importe que ya está en pantalla.
    const pagosFinales = [{ metodo: metodoActivo, monto: montoCobrado }];
    setProcesando(true);
    try {
      const db = await abrirBaseDeDatos();
      const turno = await turnoAbierto(db);
      if (!turno) throw new Error("No hay un turno de caja abierto — abre caja antes de cobrar.");
      const venta = await confirmarVenta(db, { items, pagos: pagosFinales, totales: t, turnoId: turno.id, usuarioId: usuario.id });
      limpiar();
      // Empuje inmediato al ERP. Antes la venta solo se encolaba y esperaba hasta 45 s al
      // siguiente tick del temporizador: era la causa principal de que una venta recién cobrada
      // no se viera en la web. No se espera (`await`) a propósito — la venta ya está confirmada
      // e irrevocable, y el cajero no debe quedarse mirando una pantalla bloqueada por la red.
      sincronizarPronto();
      // La venta ya está confirmada e irrevocable en este punto — lo que pase con la impresión
      // de aquí en adelante nunca la afecta (ver printing/imprimirTicket.ts).
      await imprimirTicket(db, venta.id);
      onCobrado(venta.id, venta.folioLocal, venta.total);
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
          {metodos.map((m) => (
            <TouchableOpacity key={m.valor} onPress={() => elegirMetodo(m.valor)} style={[estilos.botonChip, metodoActivo === m.valor && estilos.botonChipActivo]}>
              <Text style={{ color: metodoActivo === m.valor ? "#fff" : colores.texto }}>{m.icono} {m.etiqueta}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={estilos.totalesBox}>
          <Text style={[estilos.totalGrande, { color: restante > 0 ? colores.navyTexto : colores.green }]}>
            {restante > 0 ? `Falta cubrir: $${restante.toFixed(2)}` : `Cambio: $${cambio.toFixed(2)}`}
          </Text>
        </View>

        <View style={estilos.tecladoContenedor}>
          <Text style={estilos.etiquetaMonto}>Paga con (déjalo en 0 si es importe exacto)</Text>
          <Text style={estilos.montoIngresado}>${montoInput}</Text>
          <View style={estilos.teclado}>
            {TECLAS.map((k) => (
              <TouchableOpacity key={k} onPress={() => presionarTecla(k)} style={[estilos.tecla, k === "borrar" && estilos.teclaBorrar]}>
                <Text style={{ fontSize: 20, fontWeight: "700", color: k === "borrar" ? colores.red : colores.texto }}>{k === "borrar" ? "⌫" : k}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {error && <Text style={estilos.error}>{error}</Text>}

        <View style={{ flexDirection: "row", gap: 10, marginTop: 16, marginBottom: 30 }}>
          <TouchableOpacity onPress={onCerrar} style={[estilos.botonAccion, { backgroundColor: colores.gray200 }]}>
            <Text style={{ color: colores.texto }}>Cancelar</Text>
          </TouchableOpacity>
          {/* Bloquear en vez de dejar confirmar y fallar: si el importe tecleado no alcanza,
              `validarPagoSuficiente` rechazaría la venta con un error que el cajero ve
              demasiado tarde. */}
          <TouchableOpacity
            onPress={confirmar}
            disabled={procesando || restante > 0}
            style={[estilos.botonAccion, { flex: 2, backgroundColor: restante > 0 ? colores.gray200 : colores.green }]}
          >
            <Text style={{ color: restante > 0 ? colores.texto : "#fff", fontWeight: "700", fontSize: 16 }}>
              {procesando ? "Procesando…" : "Confirmar pago"}
            </Text>
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
    etiquetaMonto: { fontSize: 12, textAlign: "center", color: colores.textoSecundario, marginBottom: 2 },
    montoIngresado: { fontSize: 30, fontWeight: "800", textAlign: "center", color: colores.texto, marginBottom: 12 },
    teclado: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    tecla: { width: "30%", aspectRatio: 1.6, backgroundColor: colores.superficie, borderRadius: 10, borderWidth: 1, borderColor: colores.borde, alignItems: "center", justifyContent: "center" },
    teclaBorrar: { backgroundColor: colores.red + "22" },
    error: { color: colores.red, marginTop: 12 },
    botonAccion: { flex: 1, padding: 16, borderRadius: 12, alignItems: "center", minHeight: 56, justifyContent: "center" },
  });
}
