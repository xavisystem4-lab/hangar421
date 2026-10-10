import { Modal, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { usarColores } from "../store/temaStore";
import { textoCorte, type CorteDetallado } from "../caja/corteDetallado";

const dinero = (n: number) => `$${n.toFixed(2)}`;
const fechaHora = (iso: string) => {
  const f = new Date(iso);
  return Number.isNaN(f.getTime()) ? iso : f.toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

/**
 * Ventana flotante con el corte de caja completo y en orden: fondo (aparte, no es venta), ventas
 * por método de pago, mostrador vs. plataformas, ingresos, egresos, efectivo que debe haber en el
 * cajón, conteo por denominación y resultado. Sirve en vivo (mientras se cuenta) y como resumen
 * final al cerrar. "Compartir" manda el mismo corte en texto (WhatsApp, correo…).
 */
export function ModalCorteDetallado({ corte, onCerrar }: { corte: CorteDetallado; onCerrar: () => void }) {
  const colores = usarColores();
  const e = crearEstilos(colores);
  const dif = corte.resultado.diferencia;
  const colorDif = dif === 0 ? colores.green : colores.red;

  const Seccion = ({ titulo, color, children }: { titulo: string; color?: string; children: React.ReactNode }) => (
    <View style={[e.seccion, color ? { borderLeftColor: color } : null]}>
      <Text style={[e.tituloSeccion, color ? { color } : null]}>{titulo}</Text>
      {children}
    </View>
  );
  const Fila = ({ etiqueta, valor, fuerte, color, sangria }: { etiqueta: string; valor: string; fuerte?: boolean; color?: string; sangria?: boolean }) => (
    <View style={e.fila}>
      <Text style={[e.etiqueta, sangria && { paddingLeft: 14, color: colores.textoSecundario }, fuerte && e.fuerte]} numberOfLines={2}>{etiqueta}</Text>
      <Text style={[e.valor, fuerte && e.fuerte, color ? { color } : null]}>{valor}</Text>
    </View>
  );

  async function compartir() {
    try {
      await Share.share({ message: textoCorte(corte), title: "Corte de caja HANGAR 421" });
    } catch {
      /* el usuario canceló */
    }
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onCerrar}>
      <View style={e.fondo}>
        <View style={e.hoja}>
          <View style={e.cabecera}>
            <View style={{ flex: 1 }}>
              <Text style={e.titulo}>{corte.encabezado.cerrado ? "Corte de caja" : "Corte de caja · en curso"}</Text>
              <Text style={e.sub}>
                {corte.encabezado.sucursal ? `${corte.encabezado.sucursal} · ` : ""}{corte.encabezado.cajero}
              </Text>
              <Text style={e.sub}>
                Apertura {fechaHora(corte.encabezado.abiertoAt)} · {corte.encabezado.cerrado ? "Cierre" : "Consulta"} {fechaHora(corte.encabezado.cortadoAt)}
                {corte.encabezado.tipoCambioUsd ? ` · Dólar ${dinero(corte.encabezado.tipoCambioUsd)}` : ""}
              </Text>
            </View>
            <TouchableOpacity onPress={onCerrar} accessibilityLabel="Cerrar" style={e.botonCerrar}><Text style={{ color: colores.texto, fontSize: 20 }}>✕</Text></TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: 12 }}>
            {/* 1. Fondo: aparte, para que nadie lo tome como venta. */}
            <Seccion titulo="1 · Fondo de caja" color={colores.amber}>
              <Fila etiqueta="Fondo inicial (no es venta, no se suma al corte)" valor={dinero(corte.fondo)} fuerte />
            </Seccion>

            {/* 2. Ventas por método de pago. */}
            <Seccion titulo="2 · Ventas del turno" color={colores.green}>
              <Fila etiqueta={`Total vendido · ${corte.ventas.tickets} ticket${corte.ventas.tickets === 1 ? "" : "s"}`} valor={dinero(corte.ventas.total)} fuerte />
              {corte.ventas.porMetodo.map((m) => (
                <Fila key={m.metodo} etiqueta={`${m.etiqueta} (${m.cantidad})`} valor={dinero(m.total)} sangria />
              ))}
              {corte.ventas.porMetodo.length === 0 && <Text style={e.vacio}>Sin ventas cobradas todavía.</Text>}
            </Seccion>

            {/* 3. Mostrador vs plataformas. */}
            <Seccion titulo="3 · Mostrador y plataformas" color="#FF6A13">
              <Fila etiqueta="Mostrador" valor={dinero(corte.ventas.mostrador)} fuerte />
              <Fila etiqueta="Plataformas (DiDi / Uber / Rappi)" valor={dinero(corte.ventas.plataformas)} fuerte />
              {corte.ventas.porOrigen.filter((o) => o.origen !== "MOSTRADOR").map((o) => (
                <View key={o.origen}>
                  <Fila etiqueta={`${o.etiqueta} (${o.cantidad})`} valor={dinero(o.total)} sangria />
                  {o.porMetodo.map((m) => (
                    <Fila key={m.metodo} etiqueta={`      ${m.etiqueta}`} valor={dinero(m.total)} sangria />
                  ))}
                </View>
              ))}
            </Seccion>

            {/* 4 y 5. Ingresos y egresos con motivo. */}
            <Seccion titulo="4 · Ingresos de caja" color={colores.green}>
              {corte.ingresos.lineas.map((m, i) => <Fila key={i} etiqueta={m.motivo?.trim() || "Ingreso"} valor={`+${dinero(m.monto)}`} sangria />)}
              <Fila etiqueta="Total ingresos" valor={dinero(corte.ingresos.total)} fuerte />
            </Seccion>
            <Seccion titulo="5 · Egresos de caja" color={colores.red}>
              {corte.egresos.lineas.map((m, i) => <Fila key={i} etiqueta={m.motivo?.trim() || "Egreso"} valor={`−${dinero(m.monto)}`} sangria />)}
              <Fila etiqueta="Total egresos" valor={dinero(corte.egresos.total)} fuerte />
            </Seccion>

            {/* 6. Lo que debe haber en el cajón, con la cuenta a la vista. */}
            <Seccion titulo="6 · Efectivo que debe haber en el cajón" color={colores.navy}>
              <Fila etiqueta="Fondo inicial" valor={dinero(corte.efectivo.fondo)} sangria />
              <Fila etiqueta="+ Ventas cobradas en efectivo (pesos)" valor={dinero(corte.efectivo.ventasEfectivoMxn)} sangria />
              <Fila etiqueta="+ Ingresos" valor={dinero(corte.efectivo.ingresos)} sangria />
              <Fila etiqueta="− Egresos" valor={dinero(corte.efectivo.egresos)} sangria />
              <Fila etiqueta="= Esperado en cajón" valor={dinero(corte.efectivo.esperado)} fuerte />
            </Seccion>

            {/* 7. Conteo por denominación. */}
            <Seccion titulo="7 · Conteo por denominación" color={colores.navy}>
              {corte.conteo.billetes.length === 0 && corte.conteo.monedas.length === 0 && (
                <Text style={e.vacio}>Todavía no se captura el conteo de billetes y monedas.</Text>
              )}
              {corte.conteo.billetes.map((b) => <Fila key={`b${b.denominacion}`} etiqueta={`Billete ${dinero(b.denominacion)} × ${b.piezas}`} valor={dinero(b.subtotal)} sangria />)}
              {corte.conteo.billetes.length > 0 && <Fila etiqueta="Billetes" valor={dinero(corte.conteo.totalBilletes)} fuerte />}
              {corte.conteo.monedas.map((m) => <Fila key={`m${m.denominacion}`} etiqueta={`Moneda ${dinero(m.denominacion)} × ${m.piezas}`} valor={dinero(m.subtotal)} sangria />)}
              {corte.conteo.monedas.length > 0 && <Fila etiqueta="Monedas" valor={dinero(corte.conteo.totalMonedas)} fuerte />}
              {corte.conteo.dolares.map((u) => <Fila key={`u${u.denominacion}`} etiqueta={`US$${u.denominacion} × ${u.piezas}`} valor={`US$${u.subtotal.toFixed(2)}`} sangria />)}
              {corte.conteo.dolares.length > 0 && <Fila etiqueta="Dólares (informativo, no se suman a pesos)" valor={`US$${corte.conteo.totalUSD.toFixed(2)}`} fuerte />}
            </Seccion>

            {/* 8. Resultado. */}
            <View style={[e.resultado, { borderColor: colorDif }]}>
              <Fila etiqueta="Contado en cajón" valor={dinero(corte.resultado.contado)} fuerte />
              <Fila etiqueta="Esperado" valor={dinero(corte.resultado.esperado)} fuerte />
              <View style={[e.fila, { marginTop: 6 }]}>
                <Text style={[e.etiqueta, e.fuerte]}>Diferencia</Text>
                <Text style={[e.diferencia, { color: colorDif }]}>
                  {dif === 0 ? "✓ Cuadra" : `${dif > 0 ? "Sobran" : "Faltan"} ${dinero(Math.abs(dif))}`}
                </Text>
              </View>
              {(corte.resultado.dolaresContados > 0 || corte.resultado.dolaresEsperados > 0) && (
                <Fila
                  etiqueta={`Dólares: contados US$${corte.resultado.dolaresContados.toFixed(2)} · esperados US$${corte.resultado.dolaresEsperados.toFixed(2)}`}
                  valor={corte.resultado.diferenciaUsd === 0 ? "✓" : `${corte.resultado.diferenciaUsd > 0 ? "+" : "−"}US$${Math.abs(corte.resultado.diferenciaUsd).toFixed(2)}`}
                  color={corte.resultado.diferenciaUsd === 0 ? colores.green : colores.red}
                />
              )}
            </View>

            {(corte.descuentos.length > 0 || corte.canceladas > 0) && (
              <Seccion titulo="Descuentos y cancelaciones" color={colores.textoSecundario}>
                {corte.descuentos.map((d, i) => <Fila key={i} etiqueta={`#${d.folio} · ${d.motivo}`} valor="" sangria />)}
                {corte.canceladas > 0 && <Fila etiqueta="Tickets cancelados en el turno" valor={String(corte.canceladas)} />}
              </Seccion>
            )}
            {corte.observaciones && (
              <Seccion titulo="Observaciones" color={colores.textoSecundario}>
                <Text style={[e.etiqueta, { color: colores.texto }]}>{corte.observaciones}</Text>
              </Seccion>
            )}
          </ScrollView>

          <View style={e.pie}>
            <TouchableOpacity onPress={compartir} style={[e.boton, { backgroundColor: colores.gray50, borderWidth: 1, borderColor: colores.borde }]}>
              <Text style={{ color: colores.texto, fontWeight: "800" }}>📤 Compartir</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onCerrar} style={[e.boton, { backgroundColor: colores.navy }]}>
              <Text style={{ color: "#fff", fontWeight: "800" }}>Listo</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    fondo: { flex: 1, backgroundColor: "rgba(11,30,51,0.78)", justifyContent: "center", padding: 14 },
    hoja: { backgroundColor: colores.fondo, borderRadius: 18, maxHeight: "94%", overflow: "hidden" },
    cabecera: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colores.borde },
    titulo: { fontSize: 19, fontWeight: "900", color: colores.texto },
    sub: { fontSize: 12, color: colores.textoSecundario, marginTop: 2 },
    botonCerrar: { padding: 6 },
    seccion: { marginHorizontal: 14, marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: colores.superficie, borderLeftWidth: 5, borderLeftColor: colores.borde },
    tituloSeccion: { fontSize: 12, fontWeight: "900", letterSpacing: 0.6, textTransform: "uppercase", color: colores.textoSecundario, marginBottom: 6 },
    fila: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10, paddingVertical: 3 },
    etiqueta: { flex: 1, fontSize: 14, color: colores.texto },
    valor: { fontSize: 15, color: colores.texto, fontVariant: ["tabular-nums"] },
    fuerte: { fontWeight: "800" },
    vacio: { fontSize: 13, color: colores.textoSecundario, fontStyle: "italic" },
    resultado: { marginHorizontal: 14, marginTop: 12, padding: 14, borderRadius: 12, borderWidth: 2, backgroundColor: colores.superficie },
    diferencia: { fontSize: 22, fontWeight: "900" },
    pie: { flexDirection: "row", gap: 10, padding: 14, borderTopWidth: 1, borderTopColor: colores.borde },
    boton: { flex: 1, minHeight: 48, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  });
}
