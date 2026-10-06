import { useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { MetodoPago, cobroEnDolares, round2 } from "@hangar421/shared";
import { useCarritoStore } from "../store/carritoStore";
import { useAuthLocalStore } from "../store/authLocalStore";
import { usarColores } from "../store/temaStore";
import { abrirBaseDeDatos } from "../db/database";
import { confirmarVenta } from "../db/ventasRepo";
import { sincronizarPronto } from "../sync/syncEngine";
import { turnoAbierto } from "../db/turnosRepo";
import { listarMetodosPago, etiquetaMetodoPago } from "../db/metodosPagoRepo";
import { imprimirTicket } from "../printing/imprimirTicket";
import { comandaActiva, imprimirComanda } from "../printing/imprimirComanda";
import { ModalAutorizacion } from "../components/ModalAutorizacion";
import type { Autorizador } from "../auth/autorizacion";
import { extrasCobrables, motivoCortesia, totalesConCortesia } from "../caja/cortesia";
import { PERMISOS_TERMINAL, tienePermiso } from "../auth/permisosTerminal";

const ICONO: Record<MetodoPago, string> = {
  [MetodoPago.EFECTIVO]: "💵",
  [MetodoPago.EFECTIVO_USD]: "🇺🇸",
  [MetodoPago.TARJETA]: "💳",
  [MetodoPago.TRANSFERENCIA]: "🏦",
  [MetodoPago.QR]: "▦",
  [MetodoPago.OTRO]: "•",
};

// Orden de calculadora/cajero: 1-2-3 arriba y la fila final punto-cero-borrar, con el
// cero centrado bajo el 8 — es donde lo busca el pulgar por costumbre. Antes empezaba en 7
// (orden de teclado numérico de PC), que en una tablet de mostrador obliga a mirar.
/** Acento naranja del cobro, el mismo del Comandero Móvil: método activo, recuadro de "Paga con"
 *  y botón Cancelar. Solo cambia el aspecto; el comportamiento de la pantalla es el de siempre. */
const NARANJA = "#FF6A13";

const TECLAS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "borrar"];

/** Cobro — nunca toca la red: la venta se escribe local primero SIEMPRE (a diferencia del
 *  Comandero, que intenta en línea primero contra una Estación LAN). La confirmación es
 *  irrevocable en cuanto `confirmarVenta` resuelve: la transacción SQLite ya es atómica por sí
 *  sola. La impresión (Fase 2e) queda deliberadamente FUERA de esta pantalla — nunca bloquea ni
 *  puede hacer fallar una venta ya confirmada. */
export function PosCobroScreen({ onCerrar, onCobrado }: { onCerrar: () => void; onCobrado: (ventaId: string, folio: number, total: number) => void }) {
  const { items, totales, limpiar, nombreCliente } = useCarritoStore();
  const { usuario } = useAuthLocalStore();
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const totalesCarrito = totales();

  // Cortesía: la casa regala los productos; el cajero decide qué extras sí se cobran. Requiere el
  // PIN de un supervisor (mismo criterio que una cancelación). Con cortesía activa, todo lo de
  // abajo (cambio, teclado, confirmar) trabaja sobre lo que de verdad paga el cliente.
  const [cortesia, setCortesia] = useState<Autorizador | null>(null);
  const [pidiendoPinCortesia, setPidiendoPinCortesia] = useState(false);
  const [extrasCobrados, setExtrasCobrados] = useState<string[]>([]);
  const extras = useMemo(() => extrasCobrables(items), [items]);
  const t = cortesia ? totalesConCortesia(totalesCarrito, items, extrasCobrados) : totalesCarrito;

  const [metodos, setMetodos] = useState<{ valor: MetodoPago; etiqueta: string; icono: string }[]>([]);
  const [metodoActivo, setMetodoActivo] = useState<MetodoPago>(MetodoPago.EFECTIVO);
  const [montoInput, setMontoInput] = useState("0");
  // Propina (en pesos), igual que en el Comandero Móvil: el teclado escribe en el recuadro activo.
  // Se suma a lo que paga el cliente y queda anotada en el pago ("Propina $20.00"); la venta sigue
  // valiendo su total. En efectivo cuenta para el corte porque ese dinero entra al cajón.
  const [propinaInput, setPropinaInput] = useState("0");
  const [editando, setEditando] = useState<"paga" | "propina">("paga");
  // Autorización / últimos 4 dígitos de la terminal del banco, o folio de la transferencia.
  const [referencia, setReferencia] = useState("");
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

  // Pesos por dólar del turno abierto (se pregunta al abrir caja). Sin él no se cobra en dólares.
  const [tipoCambio, setTipoCambio] = useState<number | null>(null);
  useEffect(() => {
    abrirBaseDeDatos().then(turnoAbierto).then((turno) => setTipoCambio(turno?.tipoCambioUsd ?? null)).catch(() => undefined);
  }, []);

  // El teclado ya no arma pagos parciales: es solo "con cuánto paga el cliente", para calcular el
  // cambio. Dejarlo en 0 significa pago exacto — ver `montoCobrado`. En dólares se teclean los
  // dólares entregados y no hay "exacto": hay que escribirlos.
  const recibido = Number(montoInput || 0);
  const enDolares = metodoActivo === MetodoPago.EFECTIVO_USD;
  const conTeclado = metodoActivo === MetodoPago.EFECTIVO || enDolares;
  // La propina solo se captura con teclado (efectivo en pesos o dólares).
  const propina = conTeclado ? round2(Number(propinaInput || 0)) : 0;
  const aPagar = round2(t.total + propina);
  const cobroUsd = cobroEnDolares(aPagar, recibido, tipoCambio ?? 0);
  // Solo en efectivo cuenta lo tecleado; con tarjeta o transferencia siempre es el total exacto.
  const montoCobrado = metodoActivo === MetodoPago.EFECTIVO && recibido > 0 ? recibido : aPagar;
  const restante = enDolares ? (cobroUsd.suficiente ? 0 : Math.max(cobroUsd.faltanteMxn, 0.01)) : Math.max(0, aPagar - montoCobrado);
  const cambio = enDolares ? cobroUsd.cambioMxn : Math.max(0, montoCobrado - aPagar);

  // En métodos distintos de efectivo el importe es el total exacto: si la cortesía cambia el total,
  // el monto mostrado debe seguirlo.
  useEffect(() => {
    if (!conTeclado) setMontoInput(t.total.toFixed(2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.total]);

  function alternarCortesia() {
    if (cortesia) {
      setCortesia(null);
      setExtrasCobrados([]);
      return;
    }
    setPidiendoPinCortesia(true);
  }

  function alternarExtra(clave: string) {
    setExtrasCobrados((actuales) => (actuales.includes(clave) ? actuales.filter((c) => c !== clave) : [...actuales, clave]));
  }

  function elegirMetodo(metodo: MetodoPago) {
    setMetodoActivo(metodo);
    // En efectivo el cajero teclea con cuánto le pagan; en los demás métodos el importe es
    // siempre el total exacto, así que no hay nada que teclear.
    setMontoInput(metodo === MetodoPago.EFECTIVO || metodo === MetodoPago.EFECTIVO_USD ? "0" : t.total.toFixed(2));
    setReferencia("");
    setPropinaInput("0");
    setEditando("paga");
  }

  function presionarTecla(tecla: string) {
    (editando === "propina" ? setPropinaInput : setMontoInput)((m) => {
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
    // Una cortesía completa (total $0) no lleva pago: no entró dinero por ningún método.
    // Fuera de efectivo no hay cambio: se registra el total exacto, con la referencia que haya
    // dado la terminal del banco o la transferencia (viaja al ERP en `pagos.referencia`).
    //
    // `monto` es siempre lo que el pago cubre (el total): lo entregado va aparte, para el ticket.
    // Antes en efectivo se guardaba lo entregado y el corte esperaba de más el cambio devuelto.
    const notaPropina = propina > 0 ? `Propina $${propina.toFixed(2)}` : undefined;
    const pago =
      metodoActivo === MetodoPago.EFECTIVO
        ? { metodo: metodoActivo, monto: aPagar, montoRecibido: montoCobrado, referencia: notaPropina }
        : enDolares
          ? { metodo: metodoActivo, monto: aPagar, montoUsd: recibido, tipoCambio: tipoCambio ?? undefined, referencia: notaPropina }
          : { metodo: metodoActivo, monto: t.total, referencia: referencia.trim() || undefined };
    if (enDolares && !cobroUsd.suficiente) {
      setError(tipoCambio ? `Los dólares no alcanzan: faltan $${cobroUsd.faltanteMxn.toFixed(2)}.` : "Falta el tipo de cambio del dólar: fíjalo en Caja.");
      return;
    }
    const pagosFinales = aPagar > 0 ? [pago] : [];
    setProcesando(true);
    try {
      const db = await abrirBaseDeDatos();
      const turno = await turnoAbierto(db);
      if (!turno) throw new Error("No hay un turno de caja abierto — abre caja antes de cobrar.");
      const venta = await confirmarVenta(
        db,
        { items, pagos: pagosFinales, totales: t, turnoId: turno.id, usuarioId: usuario.id, nombreCliente },
        cortesia ? { cortesia: { motivo: motivoCortesia(cortesia.nombre, items, extrasCobrados), autorizadoPorId: cortesia.id } } : {},
      );
      limpiar();
      // Empuje inmediato al ERP. Antes la venta solo se encolaba y esperaba hasta 45 s al
      // siguiente tick del temporizador: era la causa principal de que una venta recién cobrada
      // no se viera en la web. No se espera (`await`) a propósito — la venta ya está confirmada
      // e irrevocable, y el cajero no debe quedarse mirando una pantalla bloqueada por la red.
      sincronizarPronto();
      // La venta ya está confirmada e irrevocable en este punto — lo que pase con la impresión
      // de aquí en adelante nunca la afecta (ver printing/imprimirTicket.ts). Se pregunta
      // porque muchos clientes no quieren ticket: imprimirlo siempre gasta papel. Si luego
      // cambian de opinión, se reimprime desde la pestaña Ventas.
      const terminar = () => onCobrado(venta.id, venta.folioLocal, venta.total);
      // La comanda de preparación sale sola al cobrar (cocina/barra no esperan al ticket del
      // cliente) y va primero. Si falla no estorba: se avisa y se puede reimprimir.
      comandaActiva(db)
        .then((activa) => (activa ? imprimirComanda(db, venta.id) : null))
        .then((r) => { if (r && !r.impreso) Alert.alert("No se imprimió la comanda", r.motivo ?? "Revisa la impresora en Admin → Impresora."); })
        .catch(() => undefined);
      Alert.alert(
        `Venta #${venta.folioLocal} cobrada`,
        "¿Quieres imprimir el ticket?",
        [
          { text: "No", style: "cancel", onPress: terminar },
          {
            text: "🖨 Imprimir",
            onPress: () => {
              // Si falla se dice por qué; el recibo en pantalla sale igual como respaldo.
              imprimirTicket(db, venta.id)
                .then((r) => { if (!r.impreso) Alert.alert("No se imprimió el ticket", r.motivo ?? "Inténtalo desde la pestaña Ventas."); })
                .finally(terminar);
            },
          },
        ],
        { cancelable: false },
      );
    } catch (e: any) {
      setError(e.message ?? "No se pudo procesar el cobro");
    } finally {
      setProcesando(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colores.fondo }}>
      <View style={estilos.encabezado}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1 }}>
          <Text style={{ fontSize: 34 }}>💵</Text>
          <View>
            <Text style={estilos.encabezadoTitulo}>Cobrar cuenta</Text>
            <Text style={estilos.encabezadoSubtitulo}>
              Mostrador · {items.reduce((s, i) => s + i.cantidad, 0)} artículo{items.reduce((s, i) => s + i.cantidad, 0) === 1 ? "" : "s"}
            </Text>
          </View>
        </View>
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
          {cortesia && (
            <>
              <View style={estilos.filaTotal}><Text style={{ color: colores.texto }}>Subtotal</Text><Text style={{ color: colores.texto }}>${t.subtotal.toFixed(2)}</Text></View>
              <View style={estilos.filaTotal}><Text style={{ color: colores.amber, fontWeight: "700" }}>🎁 Cortesía</Text><Text style={{ color: colores.amber, fontWeight: "700" }}>-${t.descuentoTotal.toFixed(2)}</Text></View>
            </>
          )}
          {propina > 0 && (
            <View style={estilos.filaTotal}><Text style={{ color: colores.green, fontSize: 15 }}>Propina</Text><Text style={{ color: colores.green, fontSize: 15, fontWeight: "700" }}>${propina.toFixed(2)}</Text></View>
          )}
          <View style={estilos.filaTotal}><Text style={[estilos.totalGrande, estilos.totalNaranja]}>{cortesia ? "A cobrar" : "Total"}</Text><Text style={[estilos.totalGrande, estilos.totalNaranja, { fontSize: 28 }]}>${aPagar.toFixed(2)}</Text></View>
        </View>

        <Text style={estilos.subtitulo}>Método de pago</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {(!cortesia || t.total > 0) && metodos.map((m) => (
            <TouchableOpacity key={m.valor} onPress={() => elegirMetodo(m.valor)} style={[estilos.botonChip, metodoActivo === m.valor && estilos.botonChipActivo]}>
              <Text style={[estilos.botonChipTexto, metodoActivo === m.valor && { color: "#fff" }]}>{m.icono} {m.etiqueta.toUpperCase()}</Text>
            </TouchableOpacity>
          ))}
          {/* Sin el permiso no se ofrece: el PIN de supervisor ya es obligatorio para la cortesía,
              así que la casilla decide quién puede siquiera pedirla. */}
          {tienePermiso(usuario, PERMISOS_TERMINAL.VENTA_CORTESIA) && (
            <TouchableOpacity onPress={alternarCortesia} style={[estilos.botonChip, cortesia && estilos.botonChipCortesia]}>
              <Text style={[estilos.botonChipTexto, cortesia && { color: colores.navy }]}>🎁 CORTESÍA{cortesia ? " ✓" : ""}</Text>
            </TouchableOpacity>
          )}
        </View>

        {cortesia && (
          <View style={estilos.cortesiaBox}>
            <Text style={estilos.cortesiaTitulo}>🎁 Cortesía autorizada por {cortesia.nombre}</Text>
            <Text style={estilos.cortesiaAyuda}>Los productos no se cobran. Toca "Cortesía" otra vez para quitarla.</Text>
            {extras.length > 0 ? (
              <>
                <Text style={[estilos.cortesiaAyuda, { fontWeight: "700", color: colores.texto, marginTop: 10 }]}>¿Qué extras sí se cobran?</Text>
                {extras.map((e) => {
                  const cobrado = extrasCobrados.includes(e.clave);
                  return (
                    <TouchableOpacity key={e.clave} onPress={() => alternarExtra(e.clave)} style={estilos.filaExtra}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colores.texto, fontWeight: "600" }}>{e.nombreExtra}</Text>
                        <Text style={estilos.cortesiaAyuda}>{e.nombreProducto} · {e.cantidad}× ${e.precioExtra.toFixed(2)} = ${e.importe.toFixed(2)}</Text>
                      </View>
                      <Text style={{ color: cobrado ? colores.green : colores.textoSecundario, marginRight: 8, fontWeight: "700" }}>{cobrado ? "Se cobra" : "Cortesía"}</Text>
                      <Switch value={cobrado} onValueChange={() => alternarExtra(e.clave)} />
                    </TouchableOpacity>
                  );
                })}
              </>
            ) : (
              <Text style={estilos.cortesiaAyuda}>Esta venta no lleva extras con costo: todo es cortesía.</Text>
            )}
          </View>
        )}

        {(!cortesia || t.total > 0) && (
        <>
        {!conTeclado ? (
          // Sin integración con terminal: el cajero cobra en la terminal del banco y aquí solo
          // lo registra. No hay teclado de "paga con" porque no hay cambio que calcular.
          <View style={estilos.tecladoContenedor}>
            <Text style={estilos.etiquetaMonto}>
              {metodoActivo === MetodoPago.TARJETA
                ? `Cobra $${t.total.toFixed(2)} en la terminal del banco y confirma aquí.`
                : `Registra el pago de $${t.total.toFixed(2)} y confirma aquí.`}
            </Text>
            <TextInput
              value={referencia}
              onChangeText={setReferencia}
              placeholder={metodoActivo === MetodoPago.TARJETA ? "Autorización o últimos 4 dígitos (opcional)" : "Referencia (opcional)"}
              placeholderTextColor={colores.textoSecundario}
              maxLength={40}
              style={estilos.inputReferencia}
            />
          </View>
        ) : (
        <>
        <View style={estilos.totalesBox}>
          {enDolares && !tipoCambio ? (
            <Text style={[estilos.totalGrande, { color: colores.red, fontSize: 16 }]}>
              Falta el tipo de cambio del dólar. Fíjalo en la pestaña Caja.
            </Text>
          ) : (
            <Text style={[estilos.totalGrande, { fontSize: 24, color: restante > 0 ? colores.red : colores.green }]}>
              {restante > 0
                ? `Falta cubrir: $${(enDolares ? cobroUsd.faltanteMxn : restante).toFixed(2)}`
                : `Cambio${enDolares ? " en pesos" : ""}: $${cambio.toFixed(2)}`}
            </Text>
          )}
          {enDolares && tipoCambio ? (
            <Text style={estilos.etiquetaMonto}>
              US$1 = ${tipoCambio.toFixed(2)} · la cuenta de ${aPagar.toFixed(2)} son US${(aPagar / tipoCambio).toFixed(2)}
              {recibido > 0 ? ` · US$${recibido.toFixed(2)} = $${cobroUsd.equivalenteMxn.toFixed(2)}` : ""}
            </Text>
          ) : null}
        </View>

        <View style={estilos.tecladoContenedor}>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <TouchableOpacity onPress={() => setEditando("paga")} style={[estilos.cajaMonto, editando !== "paga" && estilos.cajaMontoInactiva]}>
              <Text style={[estilos.cajaMontoEtiqueta, editando !== "paga" && { color: colores.textoSecundario }]}>{enDolares ? "Paga con (US$)" : "Paga con"}</Text>
              <Text style={estilos.montoIngresado}>{enDolares ? "US$" : "$"}{montoInput}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setEditando("propina")} style={[estilos.cajaMonto, editando !== "propina" && estilos.cajaMontoInactiva]}>
              <Text style={[estilos.cajaMontoEtiqueta, editando !== "propina" && { color: colores.textoSecundario }]}>Propina</Text>
              <Text style={estilos.montoIngresado}>${propinaInput}</Text>
            </TouchableOpacity>
          </View>
          <Text style={[estilos.etiquetaMonto, { marginVertical: 8 }]}>
            {editando === "propina" ? "Escribe la propina" : enDolares ? "¿Con cuántos dólares paga?" : "Déjalo en 0 si paga el importe exacto"}
          </Text>
          {editando === "paga" && (
            <View style={estilos.filaRapidos}>
              {(enDolares ? [["Exacto", "0"], ["US$10", "10"], ["US$20", "20"], ["US$50", "50"]] : [["Exacto", "0"], ["$100", "100"], ["$200", "200"], ["$500", "500"]]).map(([etiqueta, valor]) => (
                <TouchableOpacity key={etiqueta} onPress={() => setMontoInput(valor)} style={estilos.botonRapido}>
                  <Text style={estilos.botonRapidoTexto}>{etiqueta}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          <View style={estilos.teclado}>
            {TECLAS.map((k) => (
              <TouchableOpacity key={k} onPress={() => presionarTecla(k)} style={[estilos.tecla, k === "borrar" && estilos.teclaBorrar]}>
                <Text style={k === "borrar" ? estilos.teclaBorrarTexto : estilos.teclaTexto}>{k === "borrar" ? "⌫" : k}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        </>
        )}

        </>
        )}

        {error && <Text style={estilos.error}>{error}</Text>}

        <View style={{ flexDirection: "row", gap: 10, marginTop: 16, marginBottom: 30 }}>
          <TouchableOpacity onPress={onCerrar} style={[estilos.botonAccion, estilos.botonCancelar]}>
            <Text style={{ color: NARANJA, fontWeight: "600", fontSize: 16 }}>Cancelar</Text>
          </TouchableOpacity>
          {/* Bloquear en vez de dejar confirmar y fallar: si el importe tecleado no alcanza,
              `validarPagoSuficiente` rechazaría la venta con un error que el cajero ve
              demasiado tarde. */}
          <TouchableOpacity
            onPress={confirmar}
            disabled={procesando || restante > 0}
            style={[estilos.botonAccion, { flex: 2, backgroundColor: restante > 0 ? colores.gray200 : colores.green }]}
          >
            <Text style={{ color: restante > 0 ? colores.texto : "#fff", fontWeight: "800", fontSize: 17 }}>
              {procesando ? "Procesando…" : cortesia && t.total === 0 ? "Confirmar cortesía" : `Confirmar pago $${aPagar.toFixed(2)}`}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {pidiendoPinCortesia && usuario && (
        <ModalAutorizacion
          titulo="Autorizar cortesía"
          descripcion={`Se regalarán los productos de esta venta ($${totalesCarrito.subtotal.toFixed(2)}). Hace falta el PIN de un supervisor o administrador.`}
          solicitanteId={usuario.id}
          onCancelar={() => setPidiendoPinCortesia(false)}
          onAutorizado={(autorizador) => {
            setCortesia(autorizador);
            setExtrasCobrados([]);
            setPidiendoPinCortesia(false);
          }}
        />
      )}
    </View>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    encabezado: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 18, paddingVertical: 16, backgroundColor: colores.navy, borderBottomWidth: 4, borderBottomColor: NARANJA },
    encabezadoTitulo: { color: "#fff", fontWeight: "800", fontSize: 22 },
    encabezadoSubtitulo: { color: "#CFD8E6", fontSize: 14 },
    cerrar: { color: "#fff", fontSize: 26 },
    filaItem: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
    totalesBox: { borderTopWidth: 1, borderTopColor: colores.borde, marginTop: 10, paddingTop: 10 },
    filaTotal: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
    totalGrande: { color: colores.navyTexto, fontWeight: "800", fontSize: 18 },
    totalNaranja: { color: NARANJA, fontSize: 26 },
    subtitulo: { fontWeight: "700", fontSize: 17, color: colores.texto, marginTop: 16, marginBottom: 8 },
    botonChip: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 14, backgroundColor: colores.superficie, borderWidth: 1, borderColor: colores.borde, minHeight: 50, justifyContent: "center" },
    botonChipActivo: { backgroundColor: NARANJA, borderColor: NARANJA },
    botonChipTexto: { color: colores.texto, fontWeight: "800", fontSize: 15, letterSpacing: 0.3 },
    botonChipCortesia: { backgroundColor: colores.amber, borderColor: colores.amber },
    cortesiaBox: { marginTop: 14, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: colores.amber, backgroundColor: colores.superficie },
    cortesiaTitulo: { fontWeight: "800", color: colores.texto, fontSize: 15 },
    cortesiaAyuda: { fontSize: 12, color: colores.textoSecundario, marginTop: 4, lineHeight: 17 },
    filaExtra: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colores.borde },
    tecladoContenedor: { marginTop: 12, backgroundColor: colores.superficie, borderRadius: 18, padding: 12 },
    inputReferencia: { borderWidth: 1, borderColor: colores.borde, borderRadius: 8, padding: 12, minHeight: 48, marginTop: 10, color: colores.texto, backgroundColor: colores.superficie, fontSize: 15 },
    etiquetaMonto: { fontSize: 12, textAlign: "center", color: colores.textoSecundario, marginBottom: 2 },
    cajaMonto: { flex: 1, borderWidth: 2, borderColor: NARANJA, borderRadius: 14, paddingVertical: 10, alignItems: "center", backgroundColor: colores.fondo },
    cajaMontoInactiva: { borderColor: colores.borde },
    filaRapidos: { flexDirection: "row", gap: 8, marginBottom: 10 },
    botonRapido: { flex: 1, height: 40, borderRadius: 10, borderWidth: 1, borderColor: NARANJA, alignItems: "center", justifyContent: "center", backgroundColor: colores.fondo },
    botonRapidoTexto: { color: colores.texto, fontWeight: "800", fontSize: 14 },
    cajaMontoEtiqueta: { color: NARANJA, fontWeight: "700", fontSize: 13 },
    montoIngresado: { fontSize: 30, fontWeight: "800", textAlign: "center", color: colores.texto },
    teclado: { flexDirection: "row", flexWrap: "wrap", rowGap: 8, justifyContent: "space-between" },
    tecla: { width: "32%", height: 58, backgroundColor: colores.fondo, borderRadius: 12, borderWidth: 1, borderColor: colores.borde, alignItems: "center", justifyContent: "center" },
    teclaTexto: { fontSize: 26, fontWeight: "800", color: colores.texto },
    teclaBorrar: { backgroundColor: colores.red + "2E" },
    teclaBorrarTexto: { fontSize: 26, fontWeight: "800", color: colores.red },
    error: { color: colores.red, marginTop: 12 },
    botonAccion: { flex: 1, paddingHorizontal: 12, borderRadius: 14, alignItems: "center", height: 58, justifyContent: "center" },
    botonCancelar: { backgroundColor: "transparent", borderWidth: 1, borderColor: colores.borde },
  });
}
