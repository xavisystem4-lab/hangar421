import { useEffect, useState } from "react";
import { Alert, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useAuthLocalStore } from "../store/authLocalStore";
import { usarColores } from "../store/temaStore";
import { abrirBaseDeDatos } from "../db/database";
import { etiquetaMetodoPago } from "../db/metodosPagoRepo";
import { etiquetaOrigen } from "../caja/origenVenta";
import { canceladasDelTurno, descuentosDelTurno, ventasPorOrigenDelTurno, type DescuentoDelTurno, type OrigenVentas } from "../db/reportesRepo";
import { abrirTurno, cerrarTurno, ultimoTurnoCerrado, efectivoDelTurno, fijarTipoCambioTurno, listarMovimientosCaja, reasignarTurno, registrarMovimientoCaja, turnoAbierto, type MovimientoCajaLocal, type TurnoLocal } from "../db/turnosRepo";
import { listarVentasRecientes, type VentaResumen } from "../db/ventasHistorialRepo";
import { BILLETES_MXN, BILLETES_USD, MONEDAS_MXN, calcularDiferencia, construirDesglose, round2, type Conteo } from "../caja/denominaciones";
import { ColumnaDenominaciones, usarRefsDenominaciones } from "../components/DesgloseEfectivo";
import { sincronizarPronto } from "../sync/syncEngine";
import { listarUsuariosLocales, type UsuarioLocal } from "../db/usuariosLocalesRepo";
import { ModalAutorizacion } from "../components/ModalAutorizacion";
import { ModalCorteDetallado } from "../components/ModalCorteDetallado";
import { armarCorteDetallado, type CorteDetallado } from "../caja/corteDetallado";
import { obtenerNombreSucursal } from "../db/dispositivoLocal";
import type { Autorizador } from "../auth/autorizacion";
import { useExigirPermiso } from "../hooks/useExigirPermiso";
import { PERMISOS_TERMINAL } from "../auth/permisosTerminal";
import { GRAMOS_POR_CALIBRACION, MAX_CALIBRACIONES, elegirInsumoCafe, mermaPorCalibraciones } from "../caja/calibraciones";
import { listarInsumosLocales, registrarMovimiento } from "../db/inventarioRepo";
import { evaluarCuadre, textoDiferencia } from "../caja/cuadreCaja";
import { ModalFirmaPin } from "../components/ModalFirmaPin";
import { RolUsuario } from "@hangar421/shared";

/** Solo un administrador puede cerrar una caja que no cuadra. */
const ROLES_FORZAN_CIERRE: string[] = [RolUsuario.ADMIN_SUCURSAL, RolUsuario.ADMIN_CORPORATIVO];

export function PosCajaScreen() {
  const { usuario } = useAuthLocalStore();
  const { exigir, modalPermiso } = useExigirPermiso();
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const [turno, setTurno] = useState<TurnoLocal | null | undefined>(undefined);
  const [cajeros, setCajeros] = useState<UsuarioLocal[]>([]);
  const [asignando, setAsignando] = useState(false);
  const [candidato, setCandidato] = useState<UsuarioLocal | null>(null);
  const [movimientos, setMovimientos] = useState<MovimientoCajaLocal[]>([]);
  const [ventas, setVentas] = useState<VentaResumen[]>([]);
  const [montoInicial, setMontoInicial] = useState("0");
  // Conteo físico del corte, por familia de denominación — mismas listas que el POS Windows.
  const [billetesMXN, setBilletesMXN] = useState<Conteo>({});
  const [monedasMXN, setMonedasMXN] = useState<Conteo>({});
  const [billetesUSD, setBilletesUSD] = useState<Conteo>({});
  const [observaciones, setObservaciones] = useState("");
  // Ventas en efectivo del turno por moneda: pesos (ya restado el cambio dado por pagos en
  // dólares) y dólares recibidos. Ver efectivoDelTurno.
  const [ventasEnEfectivo, setVentasEnEfectivo] = useState({ mxn: 0, usd: 0 });
  // Pesos por dólar: se pide al abrir caja (y para un turno que se abrió sin él).
  const [tipoCambioInput, setTipoCambioInput] = useState("");
  // Refs de cada columna, para encadenar el foco con Enter al contar.
  const refsBilletes = usarRefsDenominaciones(BILLETES_MXN.length);
  const refsMonedas = usarRefsDenominaciones(MONEDAS_MXN.length);
  const refsDolares = usarRefsDenominaciones(BILLETES_USD.length);
  const [tipoMovimiento, setTipoMovimiento] = useState<"INGRESO" | "EGRESO">("INGRESO");
  const [montoMovimiento, setMontoMovimiento] = useState("");
  const [motivoMovimiento, setMotivoMovimiento] = useState("");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [porOrigen, setPorOrigen] = useState<OrigenVentas[]>([]);
  const [descuentos, setDescuentos] = useState<DescuentoDelTurno[]>([]);
  const [canceladas, setCanceladas] = useState(0);
  const [sucursal, setSucursal] = useState<string | null>(null);
  /** Corte mostrado en la ventana flotante: en vivo ("Ver corte") o el del turno recién cerrado. */
  const [corteVisible, setCorteVisible] = useState<CorteDetallado | null>(null);
  /** Paso previo al cierre: cuántas calibraciones tuvo la máquina de café (merma de café). */
  const [preguntandoCalibraciones, setPreguntandoCalibraciones] = useState(false);
  const [calibraciones, setCalibraciones] = useState("");
  /** Cierre que no cuadra esperando el PIN de un administrador (guarda las calibraciones). */
  const [forzando, setForzando] = useState<number | null>(null);
  /** Firma con PIN personal: de quien entrega su corte o de quien abre el siguiente turno. */
  const [firma, setFirma] = useState<
    | { tipo: "cierre"; calibraciones: number; admin: Autorizador | null }
    | { tipo: "apertura" }
    | null
  >(null);
  /** Último corte de esta sucursal: quien abre confirma lo que recibe. */
  const [ultimoCorte, setUltimoCorte] = useState<{ monto: number; responsable: string; cerradoAt: string | null } | null>(null);

  async function cargar() {
    const db = await abrirBaseDeDatos();
    const t = await turnoAbierto(db);
    setTurno(t);
    if (t) {
      setMovimientos(await listarMovimientosCaja(db, t.id));
      setVentasEnEfectivo(await efectivoDelTurno(db, t.id));
      setPorOrigen(await ventasPorOrigenDelTurno(db, t.id));
      setDescuentos(await descuentosDelTurno(db, t.id));
      setCanceladas(await canceladasDelTurno(db, t.id));
    }
    if (!t) {
      const u = await ultimoTurnoCerrado(db);
      setUltimoCorte(u ? { monto: u.turno.montoFinalDeclarado ?? 0, responsable: u.responsable, cerradoAt: u.turno.cerradoAt } : null);
    }
    setSucursal(await obtenerNombreSucursal(db));
    setVentas(await listarVentasRecientes(db, 20));
    setCajeros(await listarUsuariosLocales(db));
  }

  useEffect(() => {
    cargar();
  }, []);

  /** Antes de abrir, quien abre firma con SU PIN: deja constancia de que recibe la caja. */
  function pedirFirmaApertura() {
    if (!usuario) return;
    const tc = Number(tipoCambioInput.replace(",", "."));
    if (!(tc > 0)) {
      setMensaje("Escribe a cuánto está el dólar antes de abrir caja.");
      return;
    }
    setFirma({ tipo: "apertura" });
  }

  async function abrir() {
    if (!usuario) return;
    // Obligatorio: es lo que permite cobrar en dólares durante el turno, y se fija una vez al
    // abrir para que todo el turno use el mismo.
    const tc = Number(tipoCambioInput.replace(",", "."));
    if (!(tc > 0)) {
      setMensaje("Escribe a cuánto está el dólar antes de abrir caja.");
      return;
    }
    try {
      const db = await abrirBaseDeDatos();
      await abrirTurno(db, { usuarioId: usuario.id, montoInicial: Number(montoInicial) || 0, tipoCambioUsd: tc });
      setMensaje(`Turno abierto. Dólar a $${tc.toFixed(2)}.`);
      setMontoInicial("0");
      setTipoCambioInput("");
      cargar();
    } catch (e: any) {
      setMensaje(e.message);
    }
  }

  async function fijarTipoCambio() {
    if (!turno) return;
    try {
      await fijarTipoCambioTurno(await abrirBaseDeDatos(), turno.id, Number(tipoCambioInput.replace(",", ".")));
      setTipoCambioInput("");
      setMensaje("Tipo de cambio guardado.");
      cargar();
    } catch (e: any) {
      setMensaje(e.message);
    }
  }

  /**
   * Relevo de cajero con la caja abierta.
   *
   * Pide autorización de supervisor porque cambia quién responde por el dinero del cajón al
   * cerrar. Se valida con el PIN local, no contra el ERP: tiene que poder hacerse sin red, igual
   * que cancelar un ticket.
   */
  async function asignarA(nuevo: UsuarioLocal, autorizador: Autorizador) {
    if (!turno) return;
    try {
      const db = await abrirBaseDeDatos();
      await reasignarTurno(db, {
        turnoId: turno.id,
        nuevoUsuarioId: nuevo.id,
        autorizadoPorId: autorizador.id,
        autorizadoPorNombre: autorizador.nombre,
      });
      setAsignando(false);
      setCandidato(null);
      setMensaje(`Turno asignado a ${nuevo.nombre}.`);
      sincronizarPronto();
      cargar();
    } catch (e: any) {
      setMensaje(e?.message ?? "No se pudo asignar el turno.");
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
    return round2(turno.montoInicial + ventasEnEfectivo.mxn + ingresos - egresos);
  })();

  const desglose = construirDesglose(billetesMXN, monedasMXN, billetesUSD, observaciones);
  const diferencia = calcularDiferencia(desglose.totalMXN, efectivoEsperado);
  const diferenciaUsd = calcularDiferencia(desglose.totalUSD, ventasEnEfectivo.usd);
  // La regla de cierre: el TOTAL en pesos (dólares al tipo de cambio del turno) tiene que cuadrar.
  const cuadre = evaluarCuadre({
    contadoMXN: desglose.totalMXN,
    esperadoMXN: efectivoEsperado,
    contadoUSD: desglose.totalUSD,
    esperadoUSD: ventasEnEfectivo.usd,
    tipoCambio: turno?.tipoCambioUsd ?? null,
  });
  const hayDolares = desglose.totalUSD > 0 || ventasEnEfectivo.usd > 0;

  /** Arma el corte desglosado con lo que hay en pantalla: sirve tanto para consultarlo en vivo
   *  mientras se cuenta como para enseñar el resumen final al cerrar la caja. */
  function construirCorte(cerrado: boolean): CorteDetallado | null {
    if (!turno) return null;
    return armarCorteDetallado({
      sucursal,
      cajero: cajeros.find((c) => c.id === turno.usuarioId)?.nombre ?? "Cajero no identificado",
      abiertoAt: turno.abiertoAt,
      cortadoAt: new Date().toISOString(),
      cerrado,
      montoInicial: turno.montoInicial,
      tipoCambioUsd: turno.tipoCambioUsd,
      porOrigen,
      movimientos,
      ventasEnEfectivo,
      desglose,
      descuentos,
      canceladas,
      etiquetaMetodo: (m) => etiquetaMetodoPago[m as keyof typeof etiquetaMetodoPago] ?? m,
      etiquetaOrigen,
    });
  }

  function preguntarCalibraciones() {
    setCalibraciones("");
    setPreguntandoCalibraciones(true);
  }

  function confirmarCierre(nCalibraciones = 0) {
    const detalleUsd = hayDolares
      ? `\nDólares: contados US$${desglose.totalUSD.toFixed(2)}, esperados US$${ventasEnEfectivo.usd.toFixed(2)}${turno?.tipoCambioUsd ? ` (US$1 = $${turno.tipoCambioUsd.toFixed(2)})` : ""}.`
      : "";
    const lineaCalibraciones = nCalibraciones > 0
      ? `\nCalibraciones de la máquina: ${nCalibraciones} (merma de ${nCalibraciones * GRAMOS_POR_CALIBRACION} g de café).`
      : "\nSin calibraciones de la máquina.";

    // No cuadra: NO se cierra. Se recuenta; si de verdad falta o sobra dinero, solo un
    // administrador puede cerrar y la diferencia queda registrada en el corte.
    if (!cuadre.cuadra) {
      Alert.alert(
        "La caja no cuadra",
        `Contado: $${desglose.totalMXN.toFixed(2)} · Esperado: $${efectivoEsperado.toFixed(2)}${detalleUsd}\n\n${textoDiferencia(cuadre.diferencia)}${cuadre.sinTipoCambio ? " (el turno no tiene tipo de cambio para convertir los dólares)" : ""}.\n\nRecuenta el efectivo. Si de verdad no cuadra, solo un ADMINISTRADOR puede cerrar el turno y la diferencia queda registrada.`,
        [
          { text: "Recontar", style: "cancel" },
          { text: "Cerrar con administrador", style: "destructive", onPress: () => setForzando(nCalibraciones) },
        ],
      );
      return;
    }
    Alert.alert(
      "Cerrar caja",
      `Contado: $${desglose.totalMXN.toFixed(2)}\nEl conteo cuadra con lo esperado ($${efectivoEsperado.toFixed(2)}).${detalleUsd}${lineaCalibraciones}\n\nAl continuar firmas el corte con tu PIN. El corte no se puede deshacer.`,
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Firmar y cerrar", style: "destructive", onPress: () => setFirma({ tipo: "cierre", calibraciones: nCalibraciones, admin: null }) },
      ],
    );
  }

  async function cerrar(nCalibraciones = 0, admin: Autorizador | null = null) {
    if (!turno) return;
    // Constancia en el corte: quién firmó y, si no cuadraba, qué administrador lo cerró.
    const firmo = cajeros.find((c) => c.id === turno.usuarioId)?.nombre ?? "Cajero no identificado";
    const notas = [
      observaciones.trim(),
      `Firmó el corte: ${firmo} (PIN personal).`,
      admin ? `NO CUADRABA (${textoDiferencia(cuadre.diferencia)}): cierre autorizado por ${admin.nombre} (${admin.rol}).` : "",
    ].filter(Boolean).join("\n");
    const desgloseFinal = { ...desglose, observaciones: notas };
    // El corte se arma ANTES de limpiar el conteo: es el resumen que queda en pantalla.
    const corteFinal = construirCorte(true);
    const db = await abrirBaseDeDatos();
    // Merma del café por las calibraciones de la máquina (20 g cada una). Va antes del corte y
    // sin detenerlo: un inventario sin "Café en grano" no puede impedir cerrar la caja.
    if (nCalibraciones > 0 && usuario) {
      try {
        const cafe = elegirInsumoCafe(await listarInsumosLocales(db));
        const cantidad = cafe ? mermaPorCalibraciones(nCalibraciones, cafe.unidadMedida) : 0;
        if (cafe && cantidad > 0) {
          await registrarMovimiento(db, {
            insumoId: cafe.id,
            tipo: "MERMA",
            cantidad,
            motivo: `Calibración de la máquina de café: ${nCalibraciones} × ${GRAMOS_POR_CALIBRACION} g (cierre de turno ${turno.id.slice(-6)})`,
            usuarioId: usuario.id,
          });
        } else if (!cafe) {
          Alert.alert("Calibraciones", "No se encontró el insumo \"Café en grano\" en esta sucursal: la merma de las calibraciones no se registró.");
        }
      } catch {
        Alert.alert("Calibraciones", "No se pudo registrar la merma de las calibraciones. El corte sí se guardó.");
      }
    }
    await cerrarTurno(db, {
      turnoId: turno.id,
      // El declarado es el TOTAL CONTADO, no un número escrito a mano: es lo que hace que el
      // desglose y la cifra del corte no puedan contradecirse.
      montoFinalDeclarado: desglose.totalMXN,
      desgloseEfectivo: desgloseFinal,
    });
    // El corte alimenta los indicadores de caja del ERP: se sube en el momento, no al
    // siguiente tick del temporizador.
    sincronizarPronto();
    setMensaje("Turno cerrado.");
    if (corteFinal) setCorteVisible(corteFinal);
    setBilletesMXN({});
    setMonedasMXN({});
    setBilletesUSD({});
    setObservaciones("");
    cargar();
  }

  if (turno === undefined) return null;

  // El turno guarda el id; el nombre sale de la lista local. Si el cajero fue dado de baja en
  // este dispositivo ya no está en la lista, y vale más decirlo que enseñar un hueco.
  const nombreResponsable = cajeros.find((c) => c.id === turno?.usuarioId)?.nombre ?? "Cajero no identificado";

  const totalMovimientos = movimientos.reduce((s, m) => s + (m.tipo === "INGRESO" ? m.monto : -m.monto), 0);
  // Ventas reales del turno: el crédito de empleado va aparte (no entró dinero).
  const creditoTurno = porOrigen.flatMap((o) => o.porMetodo).filter((m) => m.metodo === "MONEDERO_EMPLEADO").reduce((s, m) => s + m.total, 0);
  const ticketsTurno = porOrigen.reduce((s, o) => s + o.cantidad, 0);
  const totalVentasTurno = porOrigen.reduce((s, o) => s + o.total, 0) - creditoTurno;

  return (
    <>
    <ScrollView style={{ flex: 1, backgroundColor: colores.fondo }} contentContainerStyle={{ padding: 16 }}>
      <Text style={estilos.titulo}>Caja</Text>
      {mensaje && <Text style={estilos.mensaje}>{mensaje}</Text>}

      {!turno ? (
        <View style={estilos.tarjeta}>
          <Text style={estilos.subtitulo}>Abrir turno</Text>
          {ultimoCorte && (
            <Text style={estilos.detalle}>
              Último corte: {ultimoCorte.responsable} entregó ${ultimoCorte.monto.toFixed(2)}
              {ultimoCorte.cerradoAt ? ` (${new Date(ultimoCorte.cerradoAt).toLocaleString("es-MX", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })})` : ""}. Al abrir firmas con tu PIN lo que recibes.
            </Text>
          )}
          <TextInput placeholder="Monto inicial" placeholderTextColor={colores.textoSecundario} value={montoInicial} onChangeText={setMontoInicial} keyboardType="decimal-pad" style={estilos.input} />
          <Text style={estilos.detalle}>¿A cuánto está el dólar hoy? (pesos por dólar)</Text>
          <TextInput placeholder="Ej. 18.50" placeholderTextColor={colores.textoSecundario} value={tipoCambioInput} onChangeText={setTipoCambioInput} keyboardType="decimal-pad" style={estilos.input} />
          <TouchableOpacity onPress={() => exigir(PERMISOS_TERMINAL.CAJA_ABRIR, pedirFirmaApertura)} style={estilos.botonPrincipal}><Text style={estilos.botonPrincipalTexto}>Abrir caja</Text></TouchableOpacity>
        </View>
      ) : (
        <>
          <View style={estilos.tarjeta}>
            <Text style={estilos.subtitulo}>Turno abierto</Text>
            <Text style={estilos.detalle}>Fondo inicial: ${turno.montoInicial.toFixed(2)}</Text>
            <Text style={estilos.detalle}>Ventas del turno: {ticketsTurno} · ${totalVentasTurno.toFixed(2)}</Text>
            {creditoTurno > 0 && <Text style={estilos.detalle}>👛 Crédito de empleados (no es venta): ${creditoTurno.toFixed(2)}</Text>}
            <Text style={estilos.detalle}>Movimientos: {totalMovimientos >= 0 ? "+" : ""}{totalMovimientos.toFixed(2)}</Text>
            <Text style={[estilos.detalle, estilos.esperado]}>Efectivo esperado: ${efectivoEsperado.toFixed(2)}</Text>
            <Text style={estilos.detalle}>(solo ventas cobradas en efectivo: ${ventasEnEfectivo.mxn.toFixed(2)})</Text>
            <Text style={[estilos.detalle, estilos.esperado]}>Dólares esperados: US${ventasEnEfectivo.usd.toFixed(2)}</Text>
            {turno.tipoCambioUsd ? (
              <Text style={estilos.detalle}>Tipo de cambio del turno: US$1 = ${turno.tipoCambioUsd.toFixed(2)}</Text>
            ) : (
              // Turno abierto antes de que se preguntara: sin esto no se puede cobrar en dólares.
              <View style={{ marginTop: 8 }}>
                <Text style={[estilos.detalle, { color: colores.red }]}>Este turno no tiene tipo de cambio: no se puede cobrar en dólares.</Text>
                <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                  <TextInput placeholder="¿A cuánto está el dólar? ej. 18.50" placeholderTextColor={colores.textoSecundario} value={tipoCambioInput} onChangeText={setTipoCambioInput} keyboardType="decimal-pad" style={[estilos.input, { flex: 1 }]} />
                  <TouchableOpacity onPress={fijarTipoCambio} style={estilos.botonSecundario}><Text style={estilos.botonSecundarioTexto}>Guardar</Text></TouchableOpacity>
                </View>
              </View>
            )}

            <TouchableOpacity onPress={() => setCorteVisible(construirCorte(false))} style={estilos.botonVerCorte}>
              <Text style={estilos.botonVerCorteTexto}>📋 Ver corte desglosado</Text>
            </TouchableOpacity>

            {/* Relevo de cajero sin cerrar la caja. El arqueo no se mueve: las ventas van
                enlazadas al turno, no a quién las cobró. */}
            <View style={estilos.filaResponsable}>
              <View style={{ flex: 1 }}>
                <Text style={estilos.etiquetaResponsable}>Turno asignado a</Text>
                <Text style={estilos.nombreResponsable}>{nombreResponsable}</Text>
              </View>
              <TouchableOpacity onPress={() => setAsignando(true)} style={estilos.botonSecundario}>
                <Text style={estilos.botonSecundarioTexto}>Cambiar</Text>
              </TouchableOpacity>
            </View>
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
            <TouchableOpacity onPress={() => exigir(PERMISOS_TERMINAL.CAJA_MOVIMIENTOS, agregarMovimiento)} style={estilos.botonPrincipal}><Text style={estilos.botonPrincipalTexto}>Registrar movimiento</Text></TouchableOpacity>

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

            {/* Los dólares se cuentan aparte, pero el cuadre del cierre es del TOTAL en pesos
                (dólares al tipo de cambio del turno): ver caja/cuadreCaja.ts. */}
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
              <ColumnaDenominaciones
                titulo="Dólares"
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

            {/* Ventas del turno por origen: lo cobrado como DiDi sale aparte del mostrador, con su
                desglose por método de pago (efectivo, tarjeta…). Informativo: el efectivo
                esperado de abajo ya cuenta todo el efectivo, venga de donde venga. */}
            {porOrigen.some((o) => o.origen !== "MOSTRADOR") && (
              <View style={[estilos.resumenCorte, { marginTop: 14 }]}>
                <Text style={[estilos.etiquetaResumen, { fontWeight: "800", marginBottom: 6 }]}>Ventas del turno por origen</Text>
                {porOrigen.map((o) => (
                  <View key={o.origen} style={{ marginBottom: 6 }}>
                    <View style={estilos.filaResumen}>
                      <Text style={[estilos.etiquetaResumen, { fontWeight: "700" }]}>{etiquetaOrigen(o.origen)} ({o.cantidad})</Text>
                      <Text style={estilos.valorResumen}>${o.total.toFixed(2)}</Text>
                    </View>
                    {o.porMetodo.map((m) => (
                      <View key={m.metodo} style={estilos.filaResumen}>
                        <Text style={estilos.etiquetaResumen}>{"   "}{etiquetaMetodoPago[m.metodo as keyof typeof etiquetaMetodoPago] ?? m.metodo}</Text>
                        <Text style={estilos.etiquetaResumen}>${m.total.toFixed(2)}</Text>
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            )}

            {/* Descuentos del turno con el motivo que escribió el cajero. */}
            {descuentos.length > 0 && (
              <View style={[estilos.resumenCorte, { marginTop: 14 }]}>
                <Text style={[estilos.etiquetaResumen, { fontWeight: "800", marginBottom: 6 }]}>Descuentos del turno ({descuentos.length})</Text>
                {descuentos.map((d, i) => (
                  <View key={i} style={estilos.filaResumen}>
                    <Text style={[estilos.etiquetaResumen, { flex: 1, paddingRight: 8 }]}>#{d.folio} · {d.motivo}</Text>
                  </View>
                ))}
              </View>
            )}

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
              {/* Cuadre aparte en dólares: lo esperado son los dólares recibidos en el turno. */}
              {(desglose.totalUSD > 0 || ventasEnEfectivo.usd > 0) && (
                <>
                  <View style={[estilos.filaResumen, { marginTop: 10 }]}>
                    <Text style={estilos.etiquetaResumen}>Dólares contados</Text>
                    <Text style={estilos.valorResumen}>US${desglose.totalUSD.toFixed(2)}</Text>
                  </View>
                  <View style={estilos.filaResumen}>
                    <Text style={estilos.etiquetaResumen}>Dólares esperados</Text>
                    <Text style={estilos.valorResumen}>US${ventasEnEfectivo.usd.toFixed(2)}</Text>
                  </View>
                  <View style={[estilos.filaResumen, estilos.filaDiferencia]}>
                    <Text style={estilos.etiquetaResumen}>Diferencia en dólares</Text>
                    <Text style={[estilos.valorDiferencia, { color: diferenciaUsd === 0 ? colores.green : colores.red }]}>
                      {diferenciaUsd === 0 ? "Cuadra" : `${diferenciaUsd > 0 ? "+" : "−"}US$${Math.abs(diferenciaUsd).toFixed(2)}`}
                    </Text>
                  </View>
                  {/* La que decide si se puede cerrar: todo convertido a pesos. */}
                  <View style={[estilos.filaResumen, estilos.filaDiferencia, { marginTop: 10 }]}>
                    <Text style={[estilos.etiquetaResumen, { fontWeight: "800" }]}>Diferencia total (pesos + dólares)</Text>
                    <Text style={[estilos.valorDiferencia, { color: cuadre.cuadra ? colores.green : colores.red }]}>
                      {cuadre.cuadra ? "Cuadra" : `${cuadre.diferencia > 0 ? "+" : "−"}$${Math.abs(cuadre.diferencia).toFixed(2)}`}
                    </Text>
                  </View>
                </>
              )}
              {!cuadre.cuadra && (
                <Text style={{ color: colores.red, fontSize: 12, marginTop: 8, fontWeight: "700" }}>
                  🔒 Mientras no cuadre no se puede cerrar el turno (solo un administrador puede autorizarlo).
                </Text>
              )}
            </View>

            {/* Revisión antes de cerrar: el corte completo en una ventana, con el fondo aparte,
                las ventas por método y origen, ingresos/egresos y el conteo por denominación. */}
            <TouchableOpacity onPress={() => setCorteVisible(construirCorte(false))} style={[estilos.botonPrincipal, { backgroundColor: colores.navy }]}>
              <Text style={estilos.botonPrincipalTexto}>📋 Ver corte desglosado</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => exigir(PERMISOS_TERMINAL.CAJA_CERRAR, preguntarCalibraciones)} style={[estilos.botonPrincipal, { backgroundColor: colores.red }]}><Text style={estilos.botonPrincipalTexto}>Cerrar caja</Text></TouchableOpacity>
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

      {/* Paso 1: a quién se le asigna. Se excluye al responsable actual: reasignarle el turno
          a quien ya lo tiene no es una operación, es un error de dedo. */}
      {asignando && turno && (
        <View style={estilos.fondoModal}>
          <View style={estilos.tarjetaModal}>
            <Text style={estilos.subtitulo}>Asignar turno a</Text>
            <Text style={estilos.detalle}>
              El arqueo no cambia: las ventas ya cobradas siguen perteneciendo a este turno. Lo que cambia es
              quién responde por el efectivo al cerrar.
            </Text>
            {cajeros.filter((c) => c.id !== turno.usuarioId).length === 0 ? (
              <Text style={estilos.detalle}>No hay otro cajero dado de alta en esta terminal.</Text>
            ) : (
              cajeros
                .filter((c) => c.id !== turno.usuarioId)
                .map((c) => (
                  <TouchableOpacity key={c.id} onPress={() => setCandidato(c)} style={estilos.filaCajero}>
                    <Text style={{ color: colores.texto, fontWeight: "700" }}>{c.nombre}</Text>
                    <Text style={{ color: colores.textoSecundario, fontSize: 12 }}>{c.rol}</Text>
                  </TouchableOpacity>
                ))
            )}
            <TouchableOpacity onPress={() => setAsignando(false)} style={[estilos.botonSecundario, { marginTop: 12 }]}>
              <Text style={estilos.botonSecundarioTexto}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Paso 2: el PIN del supervisor. Cambia quién responde por el dinero, así que no puede
          hacerlo un cajero por su cuenta. */}
      {candidato && usuario && (
        <ModalAutorizacion
          titulo={`Asignar turno a ${candidato.nombre}`}
          descripcion="A partir de ahora esa persona es la responsable del efectivo de esta caja. Hace falta el PIN de un supervisor o administrador."
          solicitanteId={usuario.id}
          onCancelar={() => setCandidato(null)}
          onAutorizado={(autorizador) => asignarA(candidato, autorizador)}
        />
      )}
      {corteVisible && <ModalCorteDetallado corte={corteVisible} onCerrar={() => setCorteVisible(null)} />}

      {/* Caja que no cuadra: solo un administrador la cierra; después firma la cajera. */}
      {forzando !== null && usuario && (
        <ModalAutorizacion
          titulo="Cerrar caja que no cuadra"
          descripcion={`${textoDiferencia(cuadre.diferencia)}. Solo un administrador puede autorizar este cierre; la diferencia queda registrada en el corte a nombre de quien lo entrega.`}
          solicitanteId={usuario.id}
          roles={ROLES_FORZAN_CIERRE}
          onCancelar={() => setForzando(null)}
          onAutorizado={(admin) => {
            const n = forzando;
            setForzando(null);
            setFirma({ tipo: "cierre", calibraciones: n, admin });
          }}
        />
      )}

      {/* Firma con PIN personal: entrega del corte (la responsable del turno) o apertura. */}
      {firma?.tipo === "cierre" && turno && (
        <ModalFirmaPin
          titulo="Firma de entrega del corte"
          descripcion={`Con tu PIN confirmas el corte: contado $${desglose.totalMXN.toFixed(2)}${hayDolares ? ` y US$${desglose.totalUSD.toFixed(2)}` : ""}${firma.admin ? ` (no cuadra: ${textoDiferencia(cuadre.diferencia)})` : ""}.`}
          usuarioId={turno.usuarioId}
          nombre={nombreResponsable}
          onCancelar={() => setFirma(null)}
          onFirmado={() => {
            const f = firma;
            setFirma(null);
            cerrar(f.calibraciones, f.admin);
          }}
        />
      )}
      {firma?.tipo === "apertura" && usuario && (
        <ModalFirmaPin
          titulo="Firma de apertura"
          descripcion={`Con tu PIN confirmas que recibes la caja con un fondo de $${(Number(montoInicial) || 0).toFixed(2)}.`}
          usuarioId={usuario.id}
          nombre={usuario.nombre}
          onCancelar={() => setFirma(null)}
          onFirmado={() => {
            setFirma(null);
            abrir();
          }}
        />
      )}

      {/* Antes de cerrar: calibraciones de la máquina de café en el turno (merma de café). */}
      <Modal visible={preguntandoCalibraciones} transparent animationType="fade" onRequestClose={() => setPreguntandoCalibraciones(false)}>
        <View style={estilos.fondoCalibraciones}>
          <View style={estilos.hojaCalibraciones}>
            <Text style={estilos.subtitulo}>☕ Calibraciones de la máquina</Text>
            <Text style={{ color: colores.textoSecundario, marginTop: 4 }}>
              ¿Cuántas calibraciones tuvo la máquina de café en este turno? Cada una se registra como merma de {GRAMOS_POR_CALIBRACION} g de café.
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 14, marginVertical: 16 }}>
              <TouchableOpacity onPress={() => setCalibraciones((c) => String(Math.max(0, (Number(c) || 0) - 1)))} style={estilos.botonPaso} accessibilityLabel="Una calibración menos">
                <Text style={estilos.botonPasoTexto}>−</Text>
              </TouchableOpacity>
              <TextInput
                value={calibraciones}
                onChangeText={(t) => setCalibraciones(t.replace(/[^0-9]/g, "").slice(0, 2))}
                placeholder="0"
                placeholderTextColor={colores.textoSecundario}
                keyboardType="number-pad"
                style={[estilos.input, { width: 90, fontSize: 28, fontWeight: "800", textAlign: "center", marginBottom: 0 }]}
              />
              <TouchableOpacity onPress={() => setCalibraciones((c) => String(Math.min(MAX_CALIBRACIONES, (Number(c) || 0) + 1)))} style={estilos.botonPaso} accessibilityLabel="Una calibración más">
                <Text style={estilos.botonPasoTexto}>+</Text>
              </TouchableOpacity>
            </View>
            <Text style={{ textAlign: "center", color: colores.texto, marginBottom: 14 }}>
              {(Number(calibraciones) || 0) > 0
                ? `Merma: ${Math.min(MAX_CALIBRACIONES, Number(calibraciones)) * GRAMOS_POR_CALIBRACION} g de café en grano`
                : "Sin calibraciones: no se registra merma"}
            </Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <TouchableOpacity onPress={() => setPreguntandoCalibraciones(false)} style={[estilos.botonPrincipal, { flex: 1, backgroundColor: colores.gray50 }]}>
                <Text style={[estilos.botonPrincipalTexto, { color: colores.texto }]}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { const n = Math.min(MAX_CALIBRACIONES, Number(calibraciones) || 0); setPreguntandoCalibraciones(false); confirmarCierre(n); }}
                style={[estilos.botonPrincipal, { flex: 1, backgroundColor: colores.red }]}
              >
                <Text style={estilos.botonPrincipalTexto}>Continuar al cierre</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      {modalPermiso}
    </>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    fondoCalibraciones: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: 24 },
    hojaCalibraciones: { backgroundColor: colores.superficie, borderRadius: 16, padding: 20, maxWidth: 460, width: "100%", alignSelf: "center" },
    botonPaso: { width: 54, height: 54, borderRadius: 27, backgroundColor: colores.navy, alignItems: "center", justifyContent: "center" },
    botonPasoTexto: { color: "#fff", fontSize: 26, fontWeight: "800" },
    botonVerCorte: { marginTop: 12, alignSelf: "flex-start", paddingHorizontal: 14, minHeight: 44, justifyContent: "center", borderRadius: 10, borderWidth: 1, borderColor: colores.navyTexto, backgroundColor: colores.gray50 },
    botonVerCorteTexto: { color: colores.navyTexto, fontWeight: "800", fontSize: 14 },
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
    filaResponsable: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colores.borde },
    etiquetaResponsable: { fontSize: 11, fontWeight: "700", color: colores.textoSecundario, letterSpacing: 0.5 },
    nombreResponsable: { fontSize: 16, fontWeight: "800", color: colores.navyTexto },
    botonSecundario: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: colores.borde, backgroundColor: colores.gray50, minHeight: 44, justifyContent: "center" },
    botonSecundarioTexto: { color: colores.texto, fontWeight: "700" },
    fondoModal: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(11,30,51,0.75)", justifyContent: "center", padding: 20 },
    tarjetaModal: { backgroundColor: colores.superficie, borderRadius: 16, padding: 20, maxHeight: "85%" },
    filaCajero: { paddingVertical: 14, paddingHorizontal: 12, borderRadius: 10, backgroundColor: colores.gray50, borderWidth: 1, borderColor: colores.borde, marginTop: 8 },
    chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: colores.gray50, borderWidth: 1, borderColor: colores.borde },
    chipActivo: { backgroundColor: colores.navy, borderColor: colores.navy },
    input: { borderWidth: 1, borderColor: colores.borde, borderRadius: 8, padding: 10, marginBottom: 8, color: colores.texto },
    botonPrincipal: { backgroundColor: colores.green, borderRadius: 10, padding: 14, alignItems: "center", marginTop: 4 },
    botonPrincipalTexto: { color: "#fff", fontWeight: "700" },
    filaMovimiento: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderTopWidth: 1, borderTopColor: colores.borde, marginTop: 6 },
  });
}
