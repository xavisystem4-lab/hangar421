import { useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useAuthLocalStore } from "../store/authLocalStore";
import { usarColores } from "../store/temaStore";
import { abrirBaseDeDatos } from "../db/database";
import { abrirTurno, cerrarTurno, listarMovimientosCaja, registrarMovimientoCaja, turnoAbierto, type MovimientoCajaLocal, type TurnoLocal } from "../db/turnosRepo";
import { listarVentasRecientes, type VentaResumen } from "../db/ventasHistorialRepo";

export function PosCajaScreen() {
  const { usuario } = useAuthLocalStore();
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const [turno, setTurno] = useState<TurnoLocal | null | undefined>(undefined);
  const [movimientos, setMovimientos] = useState<MovimientoCajaLocal[]>([]);
  const [ventas, setVentas] = useState<VentaResumen[]>([]);
  const [montoInicial, setMontoInicial] = useState("0");
  const [montoFinal, setMontoFinal] = useState("0");
  const [tipoMovimiento, setTipoMovimiento] = useState<"INGRESO" | "EGRESO">("INGRESO");
  const [montoMovimiento, setMontoMovimiento] = useState("");
  const [motivoMovimiento, setMotivoMovimiento] = useState("");
  const [mensaje, setMensaje] = useState<string | null>(null);

  async function cargar() {
    const db = await abrirBaseDeDatos();
    const t = await turnoAbierto(db);
    setTurno(t);
    if (t) setMovimientos(await listarMovimientosCaja(db, t.id));
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

  function confirmarCierre() {
    Alert.alert("Cerrar caja", "¿Confirmas el corte de caja con el monto declarado?", [
      { text: "Cancelar", style: "cancel" },
      { text: "Cerrar caja", style: "destructive", onPress: cerrar },
    ]);
  }

  async function cerrar() {
    if (!turno) return;
    const db = await abrirBaseDeDatos();
    await cerrarTurno(db, { turnoId: turno.id, montoFinalDeclarado: Number(montoFinal) || 0 });
    setMensaje("Turno cerrado.");
    setMontoFinal("0");
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
            <Text style={[estilos.detalle, estilos.esperado]}>Efectivo esperado: ${(turno.montoInicial + totalVentasTurno + totalMovimientos).toFixed(2)}</Text>
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
            <Text style={estilos.subtitulo}>Cerrar turno</Text>
            <TextInput placeholder="Monto final declarado (conteo físico)" placeholderTextColor={colores.textoSecundario} value={montoFinal} onChangeText={setMontoFinal} keyboardType="decimal-pad" style={estilos.input} />
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
