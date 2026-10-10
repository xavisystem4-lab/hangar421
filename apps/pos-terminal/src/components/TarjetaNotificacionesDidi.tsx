import { useEffect, useState } from "react";
import { Alert, Modal, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { usarColores } from "../store/temaStore";
import { notificacionesApp, type AppInstalada } from "../../modules/hangar-notificaciones";
import { sonarAvisoDidi } from "../../modules/hangar-usb-printer";
import { abrirBaseDeDatos } from "../db/database";
import { guardarConfig, obtenerConfig } from "../db/configLocalRepo";
import { formatearFechaHora } from "../reportes/armarReporte";
import { CLAVE_DIDI_REPETIR_AVISO, type PedidoDetectado } from "../plataformas/useNotificacionesDidi";

/**
 * Admin → Plataformas: "Leer la app de DiDi en esta tablet". Aquí se concede el acceso a
 * notificaciones, se elige qué app vigilar y se ve la bandeja de pedidos detectados (con el
 * texto original de la notificación, para revisar cómo lo escribe DiDi y ajustar el
 * intérprete si cambia).
 */
export function TarjetaNotificacionesDidi({ detectados, onRegistrar, onAtender, onRecargar }: {
  detectados: PedidoDetectado[];
  onRegistrar: (p: PedidoDetectado) => void;
  onAtender: (id: string) => void;
  onRecargar: () => void;
}) {
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const disponible = notificacionesApp.moduloDisponible;
  const [permiso, setPermiso] = useState(false);
  const [activo, setActivo] = useState(true);
  const [vigiladas, setVigiladas] = useState<string[]>([]);
  const [eligiendoApp, setEligiendoApp] = useState(false);
  const [apps, setApps] = useState<AppInstalada[]>([]);
  const [filtroApp, setFiltroApp] = useState("didi");
  const [verTexto, setVerTexto] = useState<string | null>(null);
  const [repetirAviso, setRepetirAviso] = useState(true);

  async function cambiarRepetir(v: boolean) {
    setRepetirAviso(v);
    try {
      const db = await abrirBaseDeDatos();
      await guardarConfig(db, CLAVE_DIDI_REPETIR_AVISO, v ? "1" : "0");
    } catch {
      /* se conserva en memoria */
    }
  }

  function refrescar() {
    if (!disponible) return;
    setPermiso(notificacionesApp.permisoConcedido());
    setActivo(notificacionesApp.activo());
    setVigiladas(notificacionesApp.paquetesVigilados());
    onRecargar();
  }

  useEffect(() => {
    refrescar();
    abrirBaseDeDatos().then((db) => obtenerConfig(db, CLAVE_DIDI_REPETIR_AVISO)).then((v) => setRepetirAviso(v !== "0")).catch(() => {});
    // El permiso se concede en Ajustes (fuera de la app); al volver se relee cada pocos segundos.
    const t = setInterval(() => { if (disponible) setPermiso(notificacionesApp.permisoConcedido()); }, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function abrirSelectorApps() {
    setApps(notificacionesApp.listarAppsInstaladas());
    setFiltroApp("didi");
    setEligiendoApp(true);
  }

  function alternarApp(paquete: string) {
    const nuevas = vigiladas.includes(paquete) ? vigiladas.filter((p) => p !== paquete) : [...vigiladas, paquete];
    notificacionesApp.guardarPaquetesVigilados(nuevas);
    setVigiladas(nuevas);
    setApps((a) => a.map((x) => ({ ...x, vigilada: nuevas.includes(x.paquete) })));
  }

  function cambiarActivo(v: boolean) {
    notificacionesApp.guardarActivo(v);
    setActivo(v);
    onRecargar();
  }

  const nombresVigiladas = vigiladas.length === 0
    ? "cualquier app de DiDi (automático)"
    : vigiladas.map((p) => apps.find((a) => a.paquete === p)?.nombre ?? p).join(", ");

  if (!disponible) {
    return (
      <View style={[estilos.tarjeta, { borderLeftWidth: 4, borderLeftColor: colores.amber }]}>
        <Text style={estilos.subtitulo}>🛵 Leer la app de DiDi en esta tablet</Text>
        <Text style={estilos.ayuda}>Esta versión de la app no trae el módulo de notificaciones. Instala la versión más reciente del APK.</Text>
      </View>
    );
  }

  return (
    <View style={[estilos.tarjeta, { borderLeftWidth: 4, borderLeftColor: "#FF6A13" }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={estilos.subtitulo}>🛵 Leer la app de DiDi en esta tablet</Text>
          <Text style={estilos.ayuda}>
            Cuando la app de DiDi Comercios avise de un pedido nuevo, el POS suena, muestra el aviso y deja el pedido listo para
            capturarlo con su número. Solo se lee la notificación (número, total, cliente); los productos se capturan a mano.
          </Text>
        </View>
        <Switch value={activo} onValueChange={cambiarActivo} />
      </View>

      <View style={[estilos.fila, { marginTop: 10 }]}>
        <Text style={[estilos.dato, { color: permiso ? colores.green : colores.red, flex: 1 }]}>
          {permiso ? "✓ Acceso a notificaciones concedido" : "✕ Falta conceder el acceso a notificaciones"}
        </Text>
        <TouchableOpacity onPress={() => notificacionesApp.abrirAjustesAcceso()} style={estilos.botonChico}>
          <Text style={estilos.botonChicoTexto}>{permiso ? "Ajustes" : "Dar acceso"}</Text>
        </TouchableOpacity>
      </View>
      {!permiso && (
        <Text style={estilos.ayuda}>
          En la pantalla de Ajustes que se abre, activa "HANGAR 421 Punto de Venta" y confirma. Android pide esto una sola vez.
        </Text>
      )}

      <View style={[estilos.fila, { marginTop: 8 }]}>
        <Text style={[estilos.ayuda, { flex: 1, marginTop: 0 }]}>App vigilada: {nombresVigiladas}</Text>
        <TouchableOpacity onPress={abrirSelectorApps} style={estilos.botonChico}>
          <Text style={estilos.botonChicoTexto}>Elegir app</Text>
        </TouchableOpacity>
      </View>

      <View style={[estilos.fila, { marginTop: 10 }]}>
        <View style={{ flex: 1 }}>
          <Text style={[estilos.dato, { marginTop: 0 }]}>🔔 Pitido distintivo de DiDi</Text>
          <Text style={estilos.ayuda}>
            Al llegar un pedido suena "ti-ti-tiii" (distinto al tono normal) y vibra. Con el recordatorio activo, cada 30 s vuelve a sonar
            un toque corto hasta que el pedido se registre o se descarte.
          </Text>
        </View>
        <TouchableOpacity onPress={() => sonarAvisoDidi()} style={estilos.botonChico} accessibilityLabel="Probar el pitido de DiDi">
          <Text style={estilos.botonChicoTexto}>▶ Probar</Text>
        </TouchableOpacity>
      </View>
      <View style={[estilos.fila, { marginTop: 6 }]}>
        <Text style={[estilos.ayuda, { flex: 1, marginTop: 0 }]}>Repetir recordatorio cada 30 s mientras haya pedidos sin registrar</Text>
        <Switch value={repetirAviso} onValueChange={cambiarRepetir} />
      </View>

      <View style={{ marginTop: 12 }}>
        <View style={estilos.fila}>
          <Text style={[estilos.subtitulo, { flex: 1 }]}>Pedidos detectados ({detectados.length})</Text>
          <TouchableOpacity onPress={refrescar}><Text style={{ color: colores.navyTexto, fontWeight: "700" }}>Actualizar</Text></TouchableOpacity>
        </View>
        {detectados.length === 0 && (
          <Text style={estilos.ayuda}>
            {permiso ? "Todavía no llega ninguna notificación de la app vigilada." : "Concede el acceso para empezar a detectar pedidos."}
          </Text>
        )}
        {detectados.map((p) => (
          <View key={p.id} style={estilos.filaPedido}>
            <TouchableOpacity style={{ flex: 1 }} onPress={() => setVerTexto(`${p.app}\n${formatearFechaHora(new Date(p.hora).toISOString())}\n\n${p.titulo}\n${p.texto}`)}>
              <Text style={[estilos.dato, { marginTop: 0 }]} numberOfLines={2}>{p.resumen}</Text>
              <Text style={estilos.ayuda} numberOfLines={1}>{p.app} · {formatearFechaHora(new Date(p.hora).toISOString())}{p.esPedidoNuevo ? "" : " · sin reconocer (tocar para ver)"}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => onRegistrar(p)} style={[estilos.botonChico, { backgroundColor: "#FF6A13" }]}>
              <Text style={[estilos.botonChicoTexto, { color: "#fff" }]}>Registrar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => Alert.alert("Descartar", "¿Quitar esta notificación de la bandeja?", [{ text: "No", style: "cancel" }, { text: "Quitar", onPress: () => onAtender(p.id) }])}
              style={estilos.botonChico}
            >
              <Text style={estilos.botonChicoTexto}>✕</Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>

      {eligiendoApp && (
        <Modal visible animationType="slide" transparent onRequestClose={() => setEligiendoApp(false)}>
          <View style={estilos.fondoModal}>
            <View style={estilos.hoja}>
              <View style={estilos.fila}>
                <Text style={[estilos.subtitulo, { flex: 1 }]}>¿Qué app avisa los pedidos?</Text>
                <TouchableOpacity onPress={() => setEligiendoApp(false)}><Text style={{ color: colores.textoSecundario, fontSize: 20 }}>✕</Text></TouchableOpacity>
              </View>
              <Text style={estilos.ayuda}>Marca la app de DiDi Comercios (o la de otra plataforma). Sin ninguna marcada se vigila cualquier app con "DiDi" en el nombre.</Text>
              <TextInput value={filtroApp} onChangeText={setFiltroApp} placeholder="Buscar app…" placeholderTextColor={colores.textoSecundario} style={estilos.input} />
              <ScrollView style={{ maxHeight: 360 }}>
                {apps
                  .filter((a) => !filtroApp.trim() || `${a.nombre} ${a.paquete}`.toLowerCase().includes(filtroApp.trim().toLowerCase()))
                  .map((a) => (
                    <TouchableOpacity key={a.paquete} onPress={() => alternarApp(a.paquete)} style={estilos.filaApp}>
                      <Text style={{ fontSize: 18, width: 28, color: a.vigilada ? colores.green : colores.textoSecundario }}>{a.vigilada ? "☑" : "☐"}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={[estilos.dato, { marginTop: 0 }]}>{a.nombre}</Text>
                        <Text style={estilos.ayuda} numberOfLines={1}>{a.paquete}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                {apps.length === 0 && <Text style={estilos.ayuda}>No se pudieron listar las apps instaladas.</Text>}
              </ScrollView>
              <TouchableOpacity onPress={() => setEligiendoApp(false)} style={[estilos.botonChico, { alignSelf: "flex-end", marginTop: 10 }]}>
                <Text style={estilos.botonChicoTexto}>Listo</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      {verTexto && (
        <Modal visible animationType="fade" transparent onRequestClose={() => setVerTexto(null)}>
          <View style={estilos.fondoModal}>
            <View style={estilos.hoja}>
              <Text style={estilos.subtitulo}>Texto de la notificación</Text>
              <Text style={[estilos.dato, { fontFamily: "monospace", marginTop: 8 }]} selectable>{verTexto}</Text>
              <TouchableOpacity onPress={() => setVerTexto(null)} style={[estilos.botonChico, { alignSelf: "flex-end", marginTop: 12 }]}>
                <Text style={estilos.botonChicoTexto}>Cerrar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    tarjeta: { backgroundColor: colores.superficie, borderRadius: 14, padding: 16, marginBottom: 12 },
    subtitulo: { fontSize: 15, fontWeight: "800", color: colores.texto, marginBottom: 2 },
    ayuda: { fontSize: 12, color: colores.textoSecundario, lineHeight: 17, marginTop: 4 },
    dato: { fontSize: 13, color: colores.texto, marginTop: 4, fontWeight: "600" },
    fila: { flexDirection: "row", alignItems: "center", gap: 10 },
    filaPedido: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colores.borde },
    filaApp: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colores.borde },
    botonChico: { paddingHorizontal: 12, minHeight: 40, justifyContent: "center", borderRadius: 8, backgroundColor: colores.gray50, borderWidth: 1, borderColor: colores.borde },
    botonChicoTexto: { color: colores.texto, fontWeight: "700", fontSize: 13 },
    input: { borderWidth: 1, borderColor: colores.borde, borderRadius: 8, padding: 10, minHeight: 44, color: colores.texto, marginVertical: 10 },
    fondoModal: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
    hoja: { backgroundColor: colores.fondo, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, maxHeight: "88%" },
  });
}
