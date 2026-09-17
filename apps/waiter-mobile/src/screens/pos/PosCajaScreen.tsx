import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { apiFetch } from "../../api/http";
import { useAuthStore } from "../../store/authStore";
import { usarColores } from "../../store/temaStore";

interface CajaDto { id: string; nombre: string }
interface TurnoDto { id: string; montoInicial: string; fechaApertura: string }
interface MovimientoDto { id: string; tipo: "INGRESO" | "EGRESO"; monto: string; motivo: string }
interface ResumenDto {
  turno: TurnoDto;
  pagosPorMetodo: { metodo: string; _sum: { monto: string | null }; _count: number }[];
  movimientos: MovimientoDto[];
  totalIngresos: number;
  totalEgresos: number;
  montoEsperado: number;
}

const ETIQUETA_METODO: Record<string, string> = { EFECTIVO: "Efectivo", TARJETA: "Tarjeta", TRANSFERENCIA: "Transferencia", QR: "QR", OTRO: "Otro" };
const BILLETES_MXN = [1000, 500, 200, 100, 50, 20];
const MONEDAS_MXN = [20, 10, 5, 2, 1];
const BILLETES_USD = [100, 50, 20, 10, 5, 1];

type Conteo = Record<number, string>;
function totalConteo(c: Conteo): number {
  return Object.entries(c).reduce((s, [denom, cant]) => s + Number(denom) * (Number(cant) || 0), 0);
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Caja de Punto de Venta — abrir turno, registrar ingresos/egresos, desglose de efectivo y
 *  corte, mismos endpoints que `apps/pos-desktop/src/screens/Caja.tsx`. Sin la navegación por
 *  teclado físico entre campos de denominación (no aplica en pantalla táctil) — se captura
 *  tocando cada campo, igual de rápido en una tablet. */
export function PosCajaScreen() {
  const { usuario, sucursalId } = useAuthStore();
  const colores = usarColores();
  const estilos = crearEstilos(colores);

  const [cajas, setCajas] = useState<CajaDto[]>([]);
  const [cajaId, setCajaId] = useState("");
  const [turno, setTurno] = useState<TurnoDto | null>(null);
  const [montoInicial, setMontoInicial] = useState("500");
  const [resumen, setResumen] = useState<ResumenDto | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [resultadoCorte, setResultadoCorte] = useState<any>(null);
  const [observaciones, setObservaciones] = useState("");

  const [billetesMXN, setBilletesMXN] = useState<Conteo>({});
  const [monedasMXN, setMonedasMXN] = useState<Conteo>({});
  const [billetesUSD, setBilletesUSD] = useState<Conteo>({});

  const [tipoMov, setTipoMov] = useState<"INGRESO" | "EGRESO">("EGRESO");
  const [montoMov, setMontoMov] = useState("");
  const [motivoMov, setMotivoMov] = useState("");
  const [enviandoMov, setEnviandoMov] = useState(false);
  const [cerrando, setCerrando] = useState(false);

  useEffect(() => {
    if (!sucursalId) return;
    apiFetch<CajaDto[]>(`/sucursales/${sucursalId}/cajas`).then((data) => {
      setCajas(data);
      if (data[0]) setCajaId(data[0].id);
    });
  }, [sucursalId]);

  useEffect(() => {
    if (!cajaId) return;
    apiFetch<TurnoDto | null>(`/caja/cajas/${cajaId}/turno-activo`).then(setTurno);
  }, [cajaId]);

  useEffect(() => {
    if (turno) cargarResumen(turno.id);
  }, [turno]);

  function cargarResumen(turnoId: string) {
    apiFetch<ResumenDto>(`/caja/turnos/${turnoId}/resumen`).then(setResumen).catch(() => undefined);
  }

  function limpiarConteo() {
    setBilletesMXN({});
    setMonedasMXN({});
    setBilletesUSD({});
    setObservaciones("");
  }

  async function abrir() {
    if (!sucursalId || !usuario) return;
    setMensaje(null);
    try {
      const t = await apiFetch<TurnoDto>("/caja/turnos/abrir", {
        method: "POST",
        body: JSON.stringify({ sucursalId, cajaId, usuarioId: usuario.id, montoInicial: Number(montoInicial) }),
      });
      setTurno(t);
      setResultadoCorte(null);
    } catch (e: any) {
      setMensaje(e.message);
    }
  }

  async function registrarMovimiento() {
    if (!turno || !usuario) return;
    const monto = Number(montoMov);
    if (!monto || monto <= 0 || !motivoMov.trim()) {
      setMensaje("Indica un monto y un motivo válidos para el movimiento");
      return;
    }
    setEnviandoMov(true);
    setMensaje(null);
    try {
      await apiFetch(`/caja/turnos/${turno.id}/movimientos`, {
        method: "POST",
        body: JSON.stringify({ tipo: tipoMov, monto, motivo: motivoMov, usuarioId: usuario.id }),
      });
      setMontoMov("");
      setMotivoMov("");
      cargarResumen(turno.id);
    } catch (e: any) {
      setMensaje(e.message);
    } finally {
      setEnviandoMov(false);
    }
  }

  async function realizarCorte() {
    if (!turno) return;
    setMensaje(null);
    setCerrando(true);
    const totalMXN = totalConteo(billetesMXN) + totalConteo(monedasMXN);
    const totalUSD = totalConteo(billetesUSD);
    try {
      const cerrado = await apiFetch(`/caja/turnos/${turno.id}/cerrar`, {
        method: "POST",
        body: JSON.stringify({ montoFinalDeclarado: totalMXN, desgloseEfectivo: { billetesMXN, monedasMXN, billetesUSD, totalMXN, totalUSD, observaciones } }),
      });
      setResultadoCorte(cerrado);
      setTurno(null);
      limpiarConteo();
    } catch (e: any) {
      setMensaje(e.message);
    } finally {
      setCerrando(false);
    }
  }

  const totalMXNContado = totalConteo(billetesMXN) + totalConteo(monedasMXN);
  const totalUSDContado = totalConteo(billetesUSD);
  const diferencia = resumen ? round2(totalMXNContado - resumen.montoEsperado) : null;
  const colorDiferencia = diferencia === null ? colores.texto : diferencia === 0 ? colores.green : diferencia > 0 ? colores.blue : colores.red;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colores.fondo }} contentContainerStyle={{ padding: 16 }}>
      <View style={estilos.filaEncabezado}>
        <Text style={estilos.titulo}>Caja</Text>
        {cajas.length > 1 && (
          <View style={{ flexDirection: "row", gap: 6 }}>
            {cajas.map((c) => (
              <TouchableOpacity key={c.id} onPress={() => setCajaId(c.id)} style={[estilos.chipCaja, cajaId === c.id && estilos.chipCajaActivo]}>
                <Text style={{ color: cajaId === c.id ? "#fff" : colores.texto, fontSize: 13 }}>{c.nombre}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {!turno && !resultadoCorte && (
        <View style={estilos.tarjeta}>
          <Text style={estilos.subtitulo}>Apertura de turno</Text>
          <Text style={estilos.etiquetaCampo}>Monto inicial</Text>
          <TextInput value={montoInicial} onChangeText={setMontoInicial} keyboardType="decimal-pad" style={estilos.input} />
          <TouchableOpacity onPress={abrir} style={estilos.botonPrincipal}>
            <Text style={estilos.botonPrincipalTexto}>Abrir caja</Text>
          </TouchableOpacity>
        </View>
      )}

      {turno && (
        <>
          <View style={estilos.tarjeta}>
            <Text style={estilos.subtitulo}>Resumen del turno</Text>
            <Text style={estilos.ayuda}>Abierto desde {new Date(turno.fechaApertura).toLocaleString("es-MX")}</Text>
            {resumen && (
              <>
                <FilaResumen etiqueta="Fondo inicial" valor={`$${Number(resumen.turno.montoInicial).toFixed(2)}`} colores={colores} />
                {resumen.pagosPorMetodo.map((p) => (
                  <FilaResumen key={p.metodo} etiqueta={`Ventas ${ETIQUETA_METODO[p.metodo] ?? p.metodo} (${p._count})`} valor={`$${Number(p._sum.monto ?? 0).toFixed(2)}`} colores={colores} />
                ))}
                <FilaResumen etiqueta="Ingresos de caja" valor={`+$${resumen.totalIngresos.toFixed(2)}`} colores={colores} color={colores.green} />
                <FilaResumen etiqueta="Egresos de caja" valor={`−$${resumen.totalEgresos.toFixed(2)}`} colores={colores} color={colores.red} />
                <View style={estilos.separador} />
                <FilaResumen etiqueta="Efectivo esperado" valor={`$${resumen.montoEsperado.toFixed(2)}`} colores={colores} negrita />
              </>
            )}
          </View>

          <View style={estilos.tarjeta}>
            <Text style={estilos.subtitulo}>Registrar ingreso / egreso</Text>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
              <TouchableOpacity onPress={() => setTipoMov("INGRESO")} style={[estilos.botonChip, tipoMov === "INGRESO" && { backgroundColor: colores.green, borderColor: colores.green }]}>
                <Text style={{ color: tipoMov === "INGRESO" ? "#fff" : colores.texto }}>Ingreso</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setTipoMov("EGRESO")} style={[estilos.botonChip, tipoMov === "EGRESO" && { backgroundColor: colores.red, borderColor: colores.red }]}>
                <Text style={{ color: tipoMov === "EGRESO" ? "#fff" : colores.texto }}>Egreso</Text>
              </TouchableOpacity>
            </View>
            <TextInput placeholder="Monto" placeholderTextColor={colores.textoSecundario} value={montoMov} onChangeText={setMontoMov} keyboardType="decimal-pad" style={estilos.input} />
            <TextInput placeholder="Motivo (ej. compra de hielo)" placeholderTextColor={colores.textoSecundario} value={motivoMov} onChangeText={setMotivoMov} style={estilos.input} />
            <TouchableOpacity onPress={registrarMovimiento} disabled={enviandoMov} style={estilos.botonSecundario}>
              <Text style={estilos.botonSecundarioTexto}>{enviandoMov ? "Registrando…" : "Registrar"}</Text>
            </TouchableOpacity>

            {resumen && resumen.movimientos.length > 0 && (
              <View style={{ marginTop: 10 }}>
                {resumen.movimientos.map((m) => (
                  <View key={m.id} style={estilos.filaMovimiento}>
                    <Text style={{ color: colores.texto, fontSize: 13 }}>{m.tipo === "INGRESO" ? "▲" : "▼"} {m.motivo}</Text>
                    <Text style={{ color: m.tipo === "INGRESO" ? colores.green : colores.red, fontWeight: "700", fontSize: 13 }}>
                      {m.tipo === "INGRESO" ? "+" : "−"}${Number(m.monto).toFixed(2)}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          <View style={estilos.tarjeta}>
            <Text style={estilos.subtitulo}>Desglose de efectivo</Text>
            <GrupoDenominaciones titulo="Billetes MXN" denominaciones={BILLETES_MXN} conteo={billetesMXN} onChange={setBilletesMXN} prefijo="$" colores={colores} />
            <GrupoDenominaciones titulo="Monedas MXN" denominaciones={MONEDAS_MXN} conteo={monedasMXN} onChange={setMonedasMXN} prefijo="$" colores={colores} />
            <GrupoDenominaciones titulo="Billetes USD" denominaciones={BILLETES_USD} conteo={billetesUSD} onChange={setBilletesUSD} prefijo="US$" colores={colores} />
            <View style={estilos.filaTotalDesglose}>
              <Text style={{ fontWeight: "700", color: colores.texto }}>Total contado</Text>
              <Text style={{ fontWeight: "800", color: colores.navyTexto }}>
                ${totalMXNContado.toFixed(2)}{totalUSDContado > 0 ? ` + US$${totalUSDContado.toFixed(2)}` : ""}
              </Text>
            </View>
          </View>

          <View style={[estilos.tarjeta, { borderWidth: 2, borderColor: colores.navy }]}>
            <Text style={estilos.subtitulo}>Corte de caja</Text>
            <FilaResumen etiqueta="Efectivo esperado" valor={`$${(resumen?.montoEsperado ?? 0).toFixed(2)}`} colores={colores} />
            <FilaResumen etiqueta="Efectivo contado" valor={`$${totalMXNContado.toFixed(2)}`} colores={colores} />
            <View style={estilos.separador} />
            <FilaResumen etiqueta="Diferencia" valor={`$${(diferencia ?? 0).toFixed(2)}`} colores={colores} color={colorDiferencia} negrita />

            <Text style={estilos.etiquetaCampo}>Observaciones</Text>
            <TextInput
              value={observaciones}
              onChangeText={setObservaciones}
              placeholder="Ej. faltante por cambio no registrado…"
              placeholderTextColor={colores.textoSecundario}
              multiline
              numberOfLines={3}
              style={[estilos.input, { minHeight: 70, textAlignVertical: "top" }]}
            />

            <TouchableOpacity onPress={realizarCorte} disabled={cerrando} style={estilos.botonPrincipal}>
              <Text style={estilos.botonPrincipalTexto}>{cerrando ? "Procesando…" : "Realizar corte de caja"}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={limpiarConteo} style={estilos.botonSecundario}>
              <Text style={estilos.botonSecundarioTexto}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {mensaje && <Text style={estilos.error}>{mensaje}</Text>}

      {resultadoCorte && (
        <View style={estilos.tarjeta}>
          <Text style={estilos.subtitulo}>Resumen del corte</Text>
          <Text style={estilos.ayuda}>Sistema (esperado): ${Number(resultadoCorte.montoFinalSistema).toFixed(2)}</Text>
          <Text style={estilos.ayuda}>Declarado (contado): ${Number(resultadoCorte.montoFinalDeclarado).toFixed(2)}</Text>
          <Text style={{ color: Number(resultadoCorte.diferencia) === 0 ? colores.green : colores.red, fontWeight: "700" }}>
            Diferencia: ${Number(resultadoCorte.diferencia).toFixed(2)}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

function FilaResumen({ etiqueta, valor, colores, color, negrita }: { etiqueta: string; valor: string; colores: ReturnType<typeof usarColores>; color?: string; negrita?: boolean }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 }}>
      <Text style={{ color: colores.texto, fontWeight: negrita ? "800" : "400" }}>{etiqueta}</Text>
      <Text style={{ color: color ?? colores.texto, fontWeight: negrita ? "800" : "600" }}>{valor}</Text>
    </View>
  );
}

function GrupoDenominaciones({
  titulo, denominaciones, conteo, onChange, prefijo, colores,
}: {
  titulo: string;
  denominaciones: number[];
  conteo: Conteo;
  onChange: (c: Conteo) => void;
  prefijo: string;
  colores: ReturnType<typeof usarColores>;
}) {
  return (
    <View style={{ marginTop: 10 }}>
      <Text style={{ fontSize: 12, color: colores.textoSecundario, fontWeight: "700", marginBottom: 6 }}>{titulo}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {denominaciones.map((d) => (
          <View key={d} style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colores.gray50, borderRadius: 8, padding: 6 }}>
            <Text style={{ fontSize: 13, fontWeight: "700", color: colores.texto, minWidth: 42 }}>{prefijo}{d}</Text>
            <TextInput
              value={conteo[d] ?? ""}
              onChangeText={(v) => onChange({ ...conteo, [d]: v })}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor={colores.textoSecundario}
              style={{ width: 48, padding: 6, borderRadius: 6, borderWidth: 1, borderColor: colores.borde, color: colores.texto }}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    filaEncabezado: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
    titulo: { fontSize: 22, fontWeight: "800", color: colores.texto },
    chipCaja: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: colores.gray50, borderWidth: 1, borderColor: colores.borde },
    chipCajaActivo: { backgroundColor: colores.navy, borderColor: colores.navy },
    tarjeta: { backgroundColor: colores.superficie, borderRadius: 14, padding: 16, marginBottom: 14 },
    subtitulo: { fontSize: 16, fontWeight: "800", color: colores.texto },
    ayuda: { fontSize: 12, color: colores.textoSecundario, marginTop: 2, marginBottom: 6 },
    etiquetaCampo: { fontSize: 13, color: colores.textoSecundario, marginTop: 10 },
    input: { borderWidth: 1, borderColor: colores.borde, borderRadius: 8, padding: 10, marginTop: 6, color: colores.texto, fontSize: 15 },
    botonPrincipal: { backgroundColor: colores.green, borderRadius: 10, padding: 14, alignItems: "center", marginTop: 12, minHeight: 48, justifyContent: "center" },
    botonPrincipalTexto: { color: "#fff", fontWeight: "700", fontSize: 15 },
    botonSecundario: { backgroundColor: colores.navy, borderRadius: 10, padding: 12, alignItems: "center", marginTop: 8, minHeight: 44, justifyContent: "center" },
    botonSecundarioTexto: { color: "#fff", fontWeight: "700" },
    botonChip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, backgroundColor: colores.gray50, borderWidth: 1, borderColor: colores.borde },
    filaMovimiento: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: colores.borde },
    separador: { borderTopWidth: 1, borderTopColor: colores.borde, marginVertical: 6 },
    filaTotalDesglose: { flexDirection: "row", justifyContent: "space-between", marginTop: 12, padding: 10, backgroundColor: colores.gray50, borderRadius: 8 },
    error: { color: colores.red, marginBottom: 14 },
  });
}
