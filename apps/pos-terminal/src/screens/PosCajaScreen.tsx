import { useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useAuthLocalStore } from "../store/authLocalStore";
import { usarColores } from "../store/temaStore";
import { abrirBaseDeDatos } from "../db/database";
import { abrirTurno, cerrarTurno, efectivoDelTurno, listarMovimientosCaja, registrarMovimientoCaja, turnoAbierto, type MovimientoCajaLocal, type TurnoLocal } from "../db/turnosRepo";
import { listarVentasRecientes, type VentaResumen } from "../db/ventasHistorialRepo";
import { BILLETES_MXN, BILLETES_USD, MONEDAS_MXN, calcularDiferencia, construirDesglose, round2, type Conteo } from "../caja/denominaciones";
import { ColumnaDenominaciones, usarRefsDenominaciones } from "../components/DesgloseEfectivo";
import { sincronizarPronto } from "../sync/syncEngine";

export function PosCajaScreen() {
  const { usuario } = useAuthLocalStore();
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const [turno, setTurno] = useState<TurnoLocal | null | undefined>(undefined);
  const [movimientos, setMovimientos] = useState<MovimientoCajaLocal[]>([]);
  const [ventas, setVentas] = useState<VentaResumen[]>([]);
  const [montoInicial, setMontoInicial] = useState("0");
  // Conteo físico del corte, por familia de denominación — mismas listas que el POS Windows.
  const [billetesMXN, setBilletesMXN] = useState<Conteo>({});
  const [monedasMXN, setMonedasMXN] = useState<Conteo>({});
  const [billetesUSD, setBilletesUSD] = useState<Conteo>({});
  const [observaciones, setObservaciones] = useState("");
  const [ventasEnEfectivo, setVentasEnEfectivo] = useState(0);
  // Refs de cada columna, para encadenar el foco con Enter al contar.
  const refsBilletes = usarRefsDenominaciones(BILLETES_MXN.length);
  const refsMonedas = usarRefsDenominaciones(MONEDAS_MXN.length);
  const refsDolares = usarRefsDenominaciones(BILLETES_USD.length);
  const [tipoMovimiento, setTipoMovimiento] = useState<"INGRESO" | "EGRESO">("INGRESO");
  const [montoMovimiento, setMontoMovimiento] = useState("");
  const [motivoMovimiento, setMotivoMovimiento] = useState("");
  const [mensaje, setMensaje] = useState<string | null>(null);

  async function cargar() {
    const db = await abrirBaseDeDatos();
    const t = await turnoAbierto(db);
    setTurno(t);
    if (t) {
      setMovimientos(await listarMovimientosCaja(db, t.id));
      setVentasEnEfectivo(await efectivoDelTurno(db, t.id));
    }
    setVentas(await listarVentasRecientes(db, 20));
  }

  useEffect(() => {
    cargar();
  }, []);

  async function abrir() {
    if (!usuario) return;
    try {
      const db = await abrirBaseDeDatos();
      await abrirTurno(db, { usuarioId: usuario.id, montoInicial: Number(montoInicial) || 0 });
      setMensaje("Turno abierto.");
      setMontoInicial("0");
      cargar();
    } catch (e: any) {
      setMensaje(e.message);
    }
  }

  async function agregarMovimiento() {
    if (!usuario || !turno || !montoMovimiento) return;
    const db = await abrirBaseDeDatos();
    await registrarMovimientoCaja(db, { turnoId: turno.id, tipo: tipoMovimiento, monto: Number(montoMovimiento), motivo: motivoMovimiento || undefined, usuarioId: usuario.id });
    setMontoMovimiento("");
    setMotivoMovimiento("");
    cargar();
  }

  /** Lo esperado en caja según el sistema: apertura + ventas en efectivo + ingresos − egresos.
   *  Se calcula en local para poder mostrar la diferencia mientras se cuenta, sin red — el ERP
   *  lo recalcula por su cuenta al recibir el corte (CajaService.calcularMontoEsperado), así que
   *  esto es una ayuda al cajero, no la cifra oficial. */
  const efectivoEsperado = (() => {
    if (!turno) return 0;
    const ingresos = movimientos.filter((m) => m.tipo === "INGRESO").reduce((s, m) => s + m.monto, 0);
    const egresos = movimientos.filter((m) => m.tipo === "EGRESO").reduce((s, m) => s + m.monto, 0);
    return round2(turno.montoInicial + ventasEnEfectivo + ingresos - egresos);
  })();

  const desglose = construirDesglose(billetesMXN, monedasMXN, billetesUSD, observaciones);
  const diferencia = calcularDiferencia(desglose.totalMXN, efectivoEsperado);

  function confirmarCierre() {
    const signo = diferencia > 0 ? "sobran" : "faltan";
    const detalle = diferencia === 0
      ? "El conteo cuadra con lo esperado."
      : `Según el conteo ${signo} $${Math.abs(diferencia).toFixed(2)} respecto a lo esperado ($${efectivoEsperado.toFixed(2)}).`;
    Alert.alert(
      "Cerrar caja",
      `Contado: $${desglose.totalMXN.toFixed(2)}\n${detalle}\n\nEl corte no se puede deshacer.`,
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Cerrar caja", style: "destructive", onPress: cerrar },
      ],
    );
  }

  async function cerrar() {
    if (!turno) return;
    const db = await abrirBaseDeDatos();
    await cerrarTurno(db, {
      turnoId: turno.id,
      // El declarado es el TOTAL CONTADO, no un número escrito a mano: es lo que hace que el
      // desglose y la cifra del corte no puedan contradecirse.
      montoFinalDeclarado: desglose.totalMXN,
      desgloseEfectivo: desglose,
    });
    // El corte alimenta los indicadores de caja del ERP: se sube en el momento, no al
    // siguiente tick del temporizador.
    sincronizarPronto();
    setMensaje("Turno cerrado.");
    setBilletesMXN({});
    setMonedasMXN({});
    setBilletesUSD({});
    setObservaciones("");
    cargar();
  }

  if (turno === undefined) return null;

  const totalMovimientos = movimientos.reduce((s, m) => s + (m.tipo === "INGRESO" ? m.monto : -m.monto), 0);
  const ventasDelTurno = turno ? ventas.filter((v) => v.estado === "COBRADA") : [];
  const totalVentasTurno = ventasDelTurno.reduce((s, v) => s + v.total, 0);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colores.fondo }} contentContainerStyle={{ padding: 16 }}>
      <Text style={estilos.titulo}>Caja</Text>
      {mensaje && <Text style={estilos.mensaje}>{mensaje}</Text>}

      {!turno ? (
        <View style={estilos.tarjeta}>
          <Text style={estilos.subtitulo}>Abrir turno</Text>
          <TextInput placeholder="Monto inicial" placeholderTextColor={colores.textoSecundario} value={montoInicial} onChangeText={setMontoInicial} keyboardType="decimal-pad" style={estilos.input} />
          <TouchableOpacity onPress={abrir} style={estilos.botonPrincipal}><Text style={estilos.botonPrincipalTexto}>Abrir caja</Text></TouchableOpacity>
        </View>
      ) : (
        <>
          <View style={estilos.tarjeta}>
            <Text style={estilos.subtitulo}>Turno abierto</Text>
            <Text style={estilos.detalle}>Fondo inicial: ${turno.montoInicial.toFixed(2)}</Text>
            <Text style={estilos.detalle}>Ventas del turno: {ventasDelTurno.length} · ${totalVentasTurno.toFixed(2)}</Text>
            <Text style={estilos.detalle}>Movimientos: {totalMovimientos >= 0 ? "+" : ""}{totalMovimientos.toFixed(2)}</Text>
            <Text style={[estilos.detalle, estilos.esperado]}>Efectivo esperado: ${efectivoEsperado.toFixed(2)}</Text>
            <Text style={estilos.detalle}>(solo ventas cobradas en efectivo: ${ventasEnEfectivo.toFixed(2)})</Text>
          </View>

          <View style={estilos.tarjeta}>
            <Text style={estilos.subtitulo}>Movimiento de caja</Text>
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
              <TouchableOpacity onPress={() => setTipoMovimiento("INGRESO")} style={[estilos.chip, tipoMovimiento === "INGRESO" && estilos.chipActivo]}>
                <Text style={{ color: tipoMovimiento === "INGRESO" ? "#fff" : colores.texto }}>Ingreso</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setTipoMovimiento("EGRESO")} style={[estilos.chip, tipoMovimiento === "EGRESO" && estilos.chipActivo]}>
                <Text style={{ color: tipoMovimiento === "EGRESO" ? "#fff" : colores.texto }}>Egreso</Text>
              </TouchableOpacity>
            </View>
            <TextInput placeholder="Monto" placeholderTextColor={colores.textoSecundario} value={montoMovimiento} onChangeText={setMontoMovimiento} keyboardType="decimal-pad" style={estilos.input} />
            <TextInput placeholder="Motivo (opcional)" placeholderTextColor={colores.textoSecundario} value={motivoMovimiento} onChangeText={setMotivoMovimiento} style={estilos.input} />
            <TouchableOpacity onPress={agregarMovimiento} style={estilos.botonPrincipal}><Text style={estilos.botonPrincipalTexto}>Registrar movimiento</Text></TouchableOpacity>

            {movimientos.map((m) => (
              <View key={m.id} style={estilos.filaMovimiento}>
                <Text style={{ color: colores.texto, fontSize: 13 }}>{m.tipo} · {m.motivo ?? "—"}</Text>
                <Text style={{ color: m.tipo === "INGRESO" ? colores.green : colores.red, fontWeight: "700" }}>{m.tipo === "INGRESO" ? "+" : "-"}${m.monto.toFixed(2)}</Text>
              </View>
            ))}
          </View>

          <View style={estilos.tarjeta}>
            <Text style={estilos.subtitulo}>Corte de caja</Text>
            <Text style={estilos.detalle}>
              Cuenta el efectivo del cajón por denominación. El total declarado sale del conteo, no se escribe a mano.
            </Text>

            {/* Billetes y monedas lado a lado: es como está el dinero en el cajón, y así se
                cuenta sin desplazarse por la pantalla. Enter baja al siguiente campo de la
                columna, y de la última fila de billetes salta a la primera de monedas. */}
            <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
              <ColumnaDenominaciones
                titulo="Billetes"
                denominaciones={BILLETES_MXN}
                conteo={billetesMXN}
                onChange={(d, c) => setBilletesMXN((s) => ({ ...s, [d]: c }))}
                refs={refsBilletes}
                onUltimo={() => refsMonedas[0]?.current?.focus()}
              />
              <ColumnaDenominaciones
                titulo="Monedas"
                denominaciones={MONEDAS_MXN}
                conteo={monedasMXN}
                onChange={(d, c) => setMonedasMXN((s) => ({ ...s, [d]: c }))}
                refs={refsMonedas}
                onUltimo={() => refsDolares[0]?.current?.focus()}
              />
            </View>

            {/* El dólar va aparte y NO se suma al efectivo MXN esperado — mismo criterio que el
                POS Windows: es informativo hasta que se cambie a pesos en una operación aparte. */}
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
              <ColumnaDenominaciones
                titulo="Dólares (informativo)"
                denominaciones={BILLETES_USD}
                conteo={billetesUSD}
                onChange={(d, c) => setBilletesUSD((s) => ({ ...s, [d]: c }))}
                prefijo="US$"
                refs={refsDolares}
              />
              <View style={{ flex: 1 }} />
            </View>

            <TextInput
              placeholder="Observaciones del corte (opcional)"
              placeholderTextColor={colores.textoSecundario}
              value={observaciones}
              onChangeText={setObservaciones}
              multiline
              style={[estilos.input, { marginTop: 14, minHeight: 60, textAlignVertical: "top" }]}
            />

            <View style={estilos.resumenCorte}>
              <View style={estilos.filaResumen}>
                <Text style={estilos.etiquetaResumen}>Contado (MXN)</Text>
                <Text style={estilos.valorResumen}>${desglose.totalMXN.toFixed(2)}</Text>
              </View>
              <View style={estilos.filaResumen}>
                <Text style={estilos.etiquetaResumen}>Esperado</Text>
                <Text style={estilos.valorResumen}>${efectivoEsperado.toFixed(2)}</Text>
              </View>
              {/* En vivo, mientras se cuenta: ver el faltante aparecer es lo que hace que el
                  cajero recuente antes de cerrar, no después. */}
              <View style={[estilos.filaResumen, estilos.filaDiferencia]}>
                <Text style={estilos.etiquetaResumen}>Diferencia</Text>
                <Text style={[estilos.valorDiferencia, { color: diferencia === 0 ? colores.green : colores.red }]}>
                  {diferencia === 0 ? "Cuadra" : `${diferencia > 0 ? "+" : "−"}$${Math.abs(diferencia).toFixed(2)}`}
                </Text>
              </View>
              {desglose.totalUSD > 0 && (
                <View style={estilos.filaResumen}>
                  <Text style={estilos.etiquetaResumen}>Dólares contados</Text>
                  <Text style={estilos.valorResumen}>US${desglose.totalUSD.toFixed(2)}</Text>
                </View>
              )}
            </View>

            <TouchableOpacity onPress={confirmarCierre} style={[estilos.botonPrincipal, { backgroundColor: colores.red }]}><Text style={estilos.botonPrincipalTexto}>Cerrar caja</Text></TouchableOpacity>
          </View>
        </>
      )}

      <View style={estilos.tarjeta}>
        <Text style={estilos.subtitulo}>Historial de ventas (local)</Text>
        {ventas.length === 0 && <Text style={estilos.detalle}>Sin ventas registradas todavía.</Text>}
        {ventas.map((v) => (
          <View key={v.id} style={estilos.filaMovimiento}>
            <Text style={{ color: colores.texto, fontSize: 13 }}>Folio #{v.folioLocal} · {new Date(v.createdAt).toLocaleString("es-MX")}</Text>
            <Text style={{ color: colores.navyTexto, fontWeight: "700" }}>${v.total.toFixed(2)}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    resumenCorte: { marginTop: 14, padding: 12, borderRadius: 10, backgroundColor: colores.gray50 },
    filaResumen: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
    filaDiferencia: { borderTopWidth: 1, borderTopColor: colores.borde, marginTop: 6, paddingTop: 8 },
    etiquetaResumen: { fontSize: 13, color: colores.textoSecundario },
    valorResumen: { fontSize: 13, fontWeight: "700", color: colores.texto },
    valorDiferencia: { fontSize: 16, fontWeight: "800" },
    titulo: { fontSize: 22, fontWeight: "800", color: colores.texto, marginBottom: 10 },
    subtitulo: { fontSize: 16, fontWeight: "800", color: colores.texto, marginBottom: 8 },
    detalle: { fontSize: 13, color: colores.textoSecundario, marginTop: 2 },
    esperado: { fontWeight: "800", color: colores.navyTexto, fontSize: 16, marginTop: 8 },
    mensaje: { color: colores.navyTexto, marginBottom: 10 },
    tarjeta: { backgroundColor: colores.superficie, borderRadius: 14, padding: 16, marginBottom: 14 },
    chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: colores.gray50, borderWidth: 1, borderColor: colores.borde },
    chipActivo: { backgroundColor: colores.navy, borderColor: colores.navy },
    input: { borderWidth: 1, borderColor: colores.borde, borderRadius: 8, padding: 10, marginBottom: 8, color: colores.texto },
    botonPrincipal: { backgroundColor: colores.green, borderRadius: 10, padding: 14, alignItems: "center", marginTop: 4 },
    botonPrincipalTexto: { color: "#fff", fontWeight: "700" },
    filaMovimiento: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderTopWidth: 1, borderTopColor: colores.borde, marginTop: 6 },
  });
}
