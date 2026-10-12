import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { usarColores } from "../store/temaStore";
import { abrirBaseDeDatos } from "../db/database";
import { contarPendientes, descartarProblema, listarProblemasSync, moverProblemaASucursalActual, type ProblemaSync } from "../db/outboxRepo";
import { obtenerNombreSucursal, obtenerSucursalErp } from "../db/dispositivoLocal";
import { subirAlErp, textoResumenSubida } from "../sync/subirAlErp";
import { formatearFechaHora } from "../reportes/armarReporte";

const ETIQUETA_ENTIDAD: Record<string, string> = {
  PEDIDO: "Venta",
  PAGO: "Cobro",
  TURNO: "Turno de caja",
  MOVIMIENTO_CAJA: "Movimiento de caja",
  MOVIMIENTO_INVENTARIO: "Movimiento de inventario",
};

/**
 * Qué no ha llegado al ERP y por qué.
 *
 * Existe porque el motivo real del fallo se guardaba en la base pero no se mostraba en ninguna
 * parte: la app decía "Error de sincronización" y el mensaje del servidor —que suele decir
 * exactamente qué hacer— se quedaba dentro de la fila. Sin esta pantalla, una venta que no llega
 * al ERP es indistinguible de una que sí llegó.
 */
export function PosAdminSincronizacionScreen({ onCerrar }: { onCerrar: () => void }) {
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const [problemas, setProblemas] = useState<ProblemaSync[]>([]);
  const [pendientes, setPendientes] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [trabajando, setTrabajando] = useState(false);
  const [sucursalActual, setSucursalActual] = useState<{ id: string; nombre: string } | null>(null);

  async function cargar() {
    const db = await abrirBaseDeDatos();
    const [p, n, id, nombre] = await Promise.all([
      listarProblemasSync(db), contarPendientes(db), obtenerSucursalErp(db), obtenerNombreSucursal(db),
    ]);
    setProblemas(p);
    setPendientes(n);
    setSucursalActual(id ? { id, nombre: nombre ?? "esta sucursal" } : null);
    setCargando(false);
  }

  /**
   * Un evento rechazado por pertenecer a otra sucursal no se arregla reintentando: el ERP lo va a
   * negar siempre. Se resuelve diciendo qué era — algo que de verdad pasó aquí (se reasigna) o
   * una prueba de cuando la tablet estuvo enlazada a otra sucursal (se saca de la cola).
   */
  function resolverAtascado(p: ProblemaSync) {
    const quees = `${ETIQUETA_ENTIDAD[p.entidad] ?? p.entidad}${p.folioLocal != null ? ` #${p.folioLocal}` : ""}`;
    Alert.alert(
      `${quees}: es de otra sucursal`,
      "El ERP lo rechaza porque se registró cuando esta tablet estaba enlazada a otra sucursal, y seguirá rechazándolo.\n\n" +
        `• Pasarlo a ${sucursalActual?.nombre ?? "esta sucursal"}: úsalo si la operación ocurrió de verdad en este local.\n` +
        "• Quitarlo de la cola: úsalo si fue una prueba. Se deja de intentar subirlo; en la tablet sigue guardado.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: `Pasarlo a ${sucursalActual?.nombre ?? "esta sucursal"}`,
          onPress: async () => {
            if (!sucursalActual) return;
            const db = await abrirBaseDeDatos();
            const movido = await moverProblemaASucursalActual(db, p.localId, sucursalActual.id);
            await cargar();
            Alert.alert(movido ? "Listo" : "Sin cambios", movido ? "Se reasignó y volverá a intentarse al subir." : "Ese registro ya era de esta sucursal: el rechazo tiene otra causa.");
          },
        },
        {
          text: "Quitarlo de la cola",
          style: "destructive",
          onPress: async () => {
            const db = await abrirBaseDeDatos();
            await descartarProblema(db, p.localId);
            await cargar();
          },
        },
      ],
    );
  }

  useEffect(() => {
    cargar();
  }, []);

  /** Mismo botón "Subir a ERP" de la barra superior (ver sync/subirAlErp.ts). */
  async function subir() {
    setTrabajando(true);
    try {
      const { titulo, detalle } = textoResumenSubida(await subirAlErp());
      await cargar();
      Alert.alert(titulo, detalle);
    } catch (e: any) {
      Alert.alert("Subir a ERP", e?.message ?? "No se pudo subir. No se perdió nada: inténtalo de nuevo.");
    } finally {
      setTrabajando(false);
    }
  }

  if (cargando) {
    return <View style={estilos.centro}><ActivityIndicator color={colores.navy} size="large" /></View>;
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colores.fondo }} contentContainerStyle={{ padding: 16 }}>
      <View style={estilos.encabezado}>
        <Text style={estilos.titulo}>Sincronización</Text>
        <TouchableOpacity onPress={onCerrar}><Text style={estilos.cerrar}>✕</Text></TouchableOpacity>
      </View>

      <View style={[estilos.tarjeta, { borderLeftWidth: 4, borderLeftColor: problemas.length > 0 ? colores.red : pendientes > 0 ? colores.amber : colores.green }]}>
        <Text style={estilos.subtitulo}>
          {problemas.length > 0
            ? `${problemas.length} con error`
            : pendientes > 0
              ? `${pendientes} en cola`
              : "Todo sincronizado"}
        </Text>
        <Text style={estilos.ayuda}>
          {problemas.length > 0
            ? "Estos registros están guardados en la tablet pero el ERP los rechazó. No se han perdido."
            : pendientes > 0
              ? "Se están subiendo. Si hay red, tardan menos de un minuto."
              : "Todo lo registrado en esta terminal está en el ERP."}
        </Text>
      </View>

      <TouchableOpacity onPress={subir} disabled={trabajando} style={estilos.botonPrincipal}>
        {trabajando
          ? <ActivityIndicator color="#fff" />
          : <Text style={estilos.botonPrincipalTexto}>⬆ Subir a ERP</Text>}
      </TouchableOpacity>

      {problemas.map((p) => (
        <View key={p.localId} style={estilos.tarjetaProblema}>
          <Text style={estilos.tituloProblema}>
            {ETIQUETA_ENTIDAD[p.entidad] ?? p.entidad}
            {p.folioLocal != null ? ` · folio #${p.folioLocal}` : ""}
          </Text>
          <Text style={estilos.ayuda}>{formatearFechaHora(p.createdAt)} · {p.intentos} intento(s)</Text>
          {/* El mensaje del servidor, tal cual: suele decir exactamente qué hacer. */}
          <Text style={estilos.mensajeError}>{p.ultimoError}</Text>
          {p.sinAccesoASucursal && (
            <TouchableOpacity onPress={() => resolverAtascado(p)} style={estilos.botonResolver}>
              <Text style={estilos.botonResolverTexto}>Resolver: es de otra sucursal</Text>
            </TouchableOpacity>
          )}
        </View>
      ))}

      {problemas.length === 0 && (
        <Text style={estilos.ayuda}>No hay registros con error.</Text>
      )}
    </ScrollView>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    centro: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colores.fondo },
    encabezado: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
    titulo: { fontSize: 22, fontWeight: "800", color: colores.texto },
    cerrar: { color: colores.textoSecundario, fontSize: 20 },
    subtitulo: { fontSize: 15, fontWeight: "800", color: colores.texto, marginBottom: 4 },
    ayuda: { fontSize: 12, color: colores.textoSecundario, lineHeight: 17 },
    botonResolver: { marginTop: 10, alignSelf: "flex-start", paddingHorizontal: 12, minHeight: 40, justifyContent: "center", borderRadius: 8, backgroundColor: colores.navy },
    botonResolverTexto: { color: "#fff", fontWeight: "800", fontSize: 13 },
    tarjeta: { backgroundColor: colores.superficie, borderRadius: 12, padding: 14, marginBottom: 14 },
    tarjetaProblema: { backgroundColor: colores.superficie, borderRadius: 10, padding: 12, marginBottom: 10, borderLeftWidth: 4, borderLeftColor: colores.red },
    tituloProblema: { fontSize: 14, fontWeight: "700", color: colores.texto },
    mensajeError: { fontSize: 12, color: colores.red, marginTop: 6, lineHeight: 17 },
    botonPrincipal: { backgroundColor: colores.navy, borderRadius: 10, padding: 15, alignItems: "center", minHeight: 50, justifyContent: "center", marginBottom: 14 },
    botonPrincipalTexto: { color: "#fff", fontWeight: "800", fontSize: 15 },
  });
}
