import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { usarColores } from "../store/temaStore";
import { abrirBaseDeDatos } from "../db/database";
import { contarPendientes, listarProblemasSync, reintentarProblema, type ProblemaSync } from "../db/outboxRepo";
import { procesarCola } from "../sync/syncEngine";
import { refrescarCatalogo } from "../sync/pullEngine";
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

  async function cargar() {
    const db = await abrirBaseDeDatos();
    const [p, n] = await Promise.all([listarProblemasSync(db), contarPendientes(db)]);
    setProblemas(p);
    setPendientes(n);
    setCargando(false);
  }

  useEffect(() => {
    cargar();
  }, []);

  async function reintentarTodo() {
    setTrabajando(true);
    try {
      const db = await abrirBaseDeDatos();
      // Se baja el catálogo antes de reintentar: la causa más común de un pedido rechazado es
      // que apunte a un producto que solo existe en la tablet, y refrescarCatalogo repara esos
      // ids (ver repararProductosLocalesEnOutbox).
      await refrescarCatalogo().catch(() => undefined);
      for (const p of problemas) await reintentarProblema(db, p.localId);
      await procesarCola(true);
      await cargar();
    } catch (e: any) {
      Alert.alert("Reintentar", e?.message ?? "No se pudo reintentar.");
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

      {problemas.length > 0 && (
        <TouchableOpacity onPress={reintentarTodo} disabled={trabajando} style={estilos.botonPrincipal}>
          {trabajando
            ? <ActivityIndicator color="#fff" />
            : <Text style={estilos.botonPrincipalTexto}>Reparar y reintentar todo</Text>}
        </TouchableOpacity>
      )}

      {problemas.map((p) => (
        <View key={p.localId} style={estilos.tarjetaProblema}>
          <Text style={estilos.tituloProblema}>
            {ETIQUETA_ENTIDAD[p.entidad] ?? p.entidad}
            {p.folioLocal != null ? ` · folio #${p.folioLocal}` : ""}
          </Text>
          <Text style={estilos.ayuda}>{formatearFechaHora(p.createdAt)} · {p.intentos} intento(s)</Text>
          {/* El mensaje del servidor, tal cual: suele decir exactamente qué hacer. */}
          <Text style={estilos.mensajeError}>{p.ultimoError}</Text>
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
    tarjeta: { backgroundColor: colores.superficie, borderRadius: 12, padding: 14, marginBottom: 14 },
    tarjetaProblema: { backgroundColor: colores.superficie, borderRadius: 10, padding: 12, marginBottom: 10, borderLeftWidth: 4, borderLeftColor: colores.red },
    tituloProblema: { fontSize: 14, fontWeight: "700", color: colores.texto },
    mensajeError: { fontSize: 12, color: colores.red, marginTop: 6, lineHeight: 17 },
    botonPrincipal: { backgroundColor: colores.navy, borderRadius: 10, padding: 15, alignItems: "center", minHeight: 50, justifyContent: "center", marginBottom: 14 },
    botonPrincipalTexto: { color: "#fff", fontWeight: "800", fontSize: 15 },
  });
}
