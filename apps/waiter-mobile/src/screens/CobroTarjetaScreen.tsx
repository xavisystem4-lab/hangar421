import { Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { usePagoStore } from "../store/pagoStore";
import { usarColores } from "../store/temaStore";

const ETIQUETA_ESTADO: Record<string, string> = {
  PENDIENTE: "Toca \"Iniciar cobro\" cuando estés con el cliente",
  ENVIADO_A_TERMINAL: "Enviado a la terminal — esperando al cliente…",
  EN_PROCESO: "Procesando en la terminal…",
  APROBADO: "Pago aprobado ✓",
  RECHAZADO: "Pago rechazado",
  CANCELADO: "Cobro cancelado",
  EXPIRADO: "La solicitud expiró",
  ERROR: "Error al procesar el pago",
};
const ESTADOS_FINALES = new Set(["APROBADO", "RECHAZADO", "CANCELADO", "EXPIRADO", "ERROR"]);

/** Pantalla de cobro con tarjeta — se muestra automáticamente ENCIMA de cualquier otra pantalla
 *  en cuanto llega una solicitud de pago dirigida a este mesero (ver App.tsx, que escucha
 *  WS_EVENTS.PAGO_SOLICITADO/PAGO_ACTUALIZADO y filtra por `meseroId === usuario.id` antes de
 *  llenar `usePagoStore`). El mesero NUNCA ve ni toca datos de tarjeta — solo confirma que va a
 *  cobrar y ve el resultado que el backend confirma con el proveedor. */
export function CobroTarjetaScreen() {
  const { solicitud, procesando, error, iniciarCobro, cancelar, limpiar } = usePagoStore();
  const colores = usarColores();
  const estilos = crearEstilos(colores);

  if (!solicitud) return null;
  const esFinal = ESTADOS_FINALES.has(solicitud.estado);
  const aprobado = solicitud.estado === "APROBADO";

  return (
    <Modal visible transparent animationType="slide">
      <View style={estilos.fondo}>
        <View style={estilos.tarjeta}>
          <Text style={estilos.titulo}>Cobro con tarjeta</Text>
          <Text style={estilos.mesa}>{solicitud.mesaNombre ?? "Mostrador"}</Text>

          <Text style={estilos.importe}>${solicitud.importe.toFixed(2)} {solicitud.moneda}</Text>
          <Text style={estilos.terminal}>Terminal: {solicitud.terminalNombre}</Text>

          <View style={[
            estilos.estadoBox,
            aprobado && { backgroundColor: colores.green },
            esFinal && !aprobado && { backgroundColor: colores.red },
          ]}>
            <Text style={[estilos.estadoTexto, esFinal && { color: colores.white }]}>
              {ETIQUETA_ESTADO[solicitud.estado] ?? solicitud.estado}
            </Text>
          </View>
          {solicitud.motivoError && <Text style={estilos.error}>{solicitud.motivoError}</Text>}
          {error && <Text style={estilos.error}>{error}</Text>}

          <View style={estilos.acciones}>
            {solicitud.estado === "PENDIENTE" && (
              <TouchableOpacity style={estilos.botonPrimario} onPress={iniciarCobro} disabled={procesando}>
                <Text style={estilos.botonPrimarioTexto}>{procesando ? "Enviando…" : "Iniciar cobro"}</Text>
              </TouchableOpacity>
            )}
            {!esFinal && (
              <TouchableOpacity style={estilos.botonSecundario} onPress={cancelar} disabled={procesando}>
                <Text style={estilos.botonSecundarioTexto}>Cancelar</Text>
              </TouchableOpacity>
            )}
            {esFinal && (
              <TouchableOpacity style={estilos.botonPrimario} onPress={limpiar}>
                <Text style={estilos.botonPrimarioTexto}>Cerrar</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    fondo: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center", padding: 20 },
    tarjeta: { width: "100%", maxWidth: 420, backgroundColor: colores.superficie, borderRadius: 20, padding: 24 },
    titulo: { fontSize: 14, color: colores.textoSecundario, textAlign: "center" },
    mesa: { fontSize: 22, fontWeight: "800", color: colores.texto, textAlign: "center", marginTop: 4 },
    importe: { fontSize: 44, fontWeight: "800", color: colores.navyTexto, textAlign: "center", marginTop: 16 },
    terminal: { fontSize: 13, color: colores.textoSecundario, textAlign: "center", marginTop: 4 },
    estadoBox: { marginTop: 20, padding: 14, borderRadius: 12, backgroundColor: colores.gray50 },
    estadoTexto: { fontSize: 16, fontWeight: "700", color: colores.texto, textAlign: "center" },
    error: { color: colores.red, fontSize: 13, textAlign: "center", marginTop: 8 },
    acciones: { flexDirection: "row", gap: 10, marginTop: 24 },
    botonPrimario: { flex: 1, backgroundColor: colores.navy, borderRadius: 12, paddingVertical: 16, alignItems: "center" },
    botonPrimarioTexto: { color: "#fff", fontSize: 16, fontWeight: "700" },
    botonSecundario: { flex: 1, backgroundColor: colores.gray200, borderRadius: 12, paddingVertical: 16, alignItems: "center" },
    botonSecundarioTexto: { color: colores.texto, fontSize: 16, fontWeight: "700" },
  });
}
