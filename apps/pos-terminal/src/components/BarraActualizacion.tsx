import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { APP_VERSION, buscarActualizacion, descargarApk, instalarApk, type InfoActualizacion } from "../updates";
import { progresoDescarga } from "../releases";
import { usarColores, useTemaStore } from "../store/temaStore";

type Estado = "buscando" | "disponible" | "al-dia" | "error";

/** Footer fijo: versión instalada a la izquierda, botón de actualización a la derecha — mismo
 *  patrón que la barra de la app de Meseros, adaptado al tema claro/oscuro del Punto de Venta
 *  (aquí los colores vienen del hook `usarColores`, no de un import estático).
 *
 *  La app se distribuye como .apk fuera de Play Store: el botón abre una ventana que descarga el
 *  .apk más nuevo de GitHub Releases con barra de progreso y, al terminar, ofrece "Instalar
 *  ahora", que abre el instalador de Android sin pasar por el navegador (ver ../updates.ts). Si
 *  la descarga falla queda "Reintentar" y, como respaldo, "Abrir en el navegador".
 *  Buscar la actualización NUNCA bloquea nada — si falla (sin red, GitHub caído, límite de la
 *  API) el botón queda en "Reintentar" y el POS sigue vendiendo con normalidad. */
export function BarraActualizacion() {
  const colores = usarColores();
  const tema = useTemaStore();
  const estilos = crearEstilos(colores);
  const [estado, setEstado] = useState<Estado>("buscando");
  const [info, setInfo] = useState<InfoActualizacion | null>(null);
  const [ventana, setVentana] = useState(false);

  async function buscar() {
    setEstado("buscando");
    try {
      const encontrada = await buscarActualizacion();
      if (encontrada) {
        setInfo(encontrada);
        setEstado("disponible");
      } else {
        setEstado("al-dia");
      }
    } catch {
      setEstado("error");
    }
  }

  useEffect(() => {
    buscar();
  }, []);

  function manejarPress() {
    if (estado === "disponible" && info) {
      setVentana(true);
      return;
    }
    buscar();
  }

  return (
    <View style={estilos.contenedor}>
      <Text style={estilos.version} numberOfLines={1}>v{APP_VERSION} — Desarrollado por Soft Gala</Text>

      {/* Modo noche. El motor de temas ya existía y seguía al sistema operativo, pero no había
          forma de forzarlo: en una barra con poca luz el turno de noche quiere oscuro aunque el
          Android esté en claro. Vive aquí, y no en la cabecera, porque esta barra se dibuja en
          todas las pantallas — incluida la de login, que es la primera que ve un cajero.
          La preferencia es del dispositivo, no del usuario logeado (ver temaStore), así que
          sobrevive al cambio de turno. */}
      <TouchableOpacity
        onPress={tema.alternar}
        style={estilos.botonTema}
        accessibilityLabel={tema.tema === "oscuro" ? "Cambiar a modo claro" : "Cambiar a modo noche"}
      >
        <Text style={estilos.botonTemaTexto}>{tema.tema === "oscuro" ? "☀" : "🌙"}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={manejarPress}
        disabled={estado === "buscando"}
        style={estilos.boton}
        accessibilityLabel={estado === "disponible" ? `Actualizar a la versión ${info?.version}` : "Buscar actualizaciones"}
      >
        {estado === "buscando" && <ActivityIndicator size="small" color="#fff" />}
        {estado === "disponible" && <Text style={estilos.botonTexto}>⬇ Actualizar a v{info?.version}</Text>}
        {estado === "al-dia" && <Text style={[estilos.botonTexto, { color: colores.green }]}>✓ Al día</Text>}
        {estado === "error" && <Text style={[estilos.botonTexto, { color: colores.red }]}>⚠ Reintentar</Text>}
      </TouchableOpacity>

      {ventana && info && <VentanaActualizacion info={info} onCerrar={() => setVentana(false)} />}
    </View>
  );
}

type Paso = "descargando" | "lista" | "instalando" | "error";

/** Ventana de actualización: descarga con barra de progreso → "Instalar ahora". */
function VentanaActualizacion({ info, onCerrar }: { info: InfoActualizacion; onCerrar: () => void }) {
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const [paso, setPaso] = useState<Paso>("descargando");
  const [avance, setAvance] = useState({ escritos: 0, total: 0 });
  const [rutaApk, setRutaApk] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  async function descargar() {
    setPaso("descargando");
    setMensaje(null);
    setAvance({ escritos: 0, total: 0 });
    try {
      const ruta = await descargarApk(info, (escritos, total) => setAvance({ escritos, total }));
      setRutaApk(ruta);
      setPaso("lista");
    } catch (e: any) {
      setMensaje(e?.message ?? "No se pudo descargar la actualización.");
      setPaso("error");
    }
  }

  useEffect(() => {
    descargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function instalar() {
    if (!rutaApk) return;
    setPaso("instalando");
    try {
      const r = await instalarApk(rutaApk);
      if (r === "permiso") {
        setMensaje('Android pide permitir que el POS instale actualizaciones: activa "Permitir de esta fuente", regresa y toca "Instalar ahora" otra vez.');
        setPaso("lista");
      } else if (r === "no-disponible") {
        await Linking.openURL(info.urlDescarga);
        onCerrar();
      } else {
        setMensaje("Se abrió el instalador de Android: confirma con \"Actualizar\". La app se reiniciará con la versión nueva.");
        setPaso("lista");
      }
    } catch (e: any) {
      setMensaje(e?.message ?? "No se pudo abrir el instalador.");
      setPaso("error");
    }
  }

  const progreso = progresoDescarga(avance.escritos, avance.total);
  const porcentaje = paso === "descargando" ? (progreso.fraccion ?? 0) : 1;

  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => paso !== "descargando" && onCerrar()}>
      <View style={estilos.fondoModal}>
        <View style={[estilos.ventana, { backgroundColor: colores.superficie }]}>
          <Text style={[estilos.tituloVentana, { color: colores.texto }]}>Actualizar a v{info.version}</Text>
          <Text style={[estilos.textoVentana, { color: colores.textoSecundario }]}>Versión instalada: v{APP_VERSION}</Text>

          <View style={[estilos.pista, { backgroundColor: colores.borde }]}>
            <View
              style={[
                estilos.relleno,
                { width: `${Math.round(porcentaje * 100)}%`, backgroundColor: paso === "error" ? colores.red : colores.green },
              ]}
            />
          </View>
          <Text style={[estilos.textoVentana, { color: colores.texto }]}>
            {paso === "descargando" && (progreso.fraccion === null && avance.escritos === 0 ? "Conectando…" : `Descargando ${progreso.texto}`)}
            {paso === "lista" && "✓ Descarga completa"}
            {paso === "instalando" && "Abriendo el instalador…"}
            {paso === "error" && "⚠ No se completó la descarga"}
          </Text>
          {mensaje && <Text style={[estilos.textoVentana, { color: paso === "error" ? colores.red : colores.textoSecundario }]}>{mensaje}</Text>}

          <View style={estilos.filaBotonesVentana}>
            {paso === "descargando" && <ActivityIndicator color={colores.navy} />}
            {(paso === "lista" || paso === "instalando") && (
              <TouchableOpacity onPress={instalar} disabled={paso === "instalando"} style={[estilos.botonVentana, { backgroundColor: colores.green }]}>
                <Text style={estilos.botonVentanaTexto}>Instalar ahora</Text>
              </TouchableOpacity>
            )}
            {paso === "error" && (
              <>
                <TouchableOpacity onPress={descargar} style={[estilos.botonVentana, { backgroundColor: colores.navy }]}>
                  <Text style={estilos.botonVentanaTexto}>Reintentar</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => Linking.openURL(info.urlDescarga).catch(() => undefined)} style={[estilos.botonVentana, { backgroundColor: colores.textoSecundario }]}>
                  <Text style={estilos.botonVentanaTexto}>Abrir en el navegador</Text>
                </TouchableOpacity>
              </>
            )}
            {paso !== "descargando" && (
              <TouchableOpacity onPress={onCerrar} style={estilos.botonVentanaSecundario}>
                <Text style={{ color: colores.textoSecundario, fontWeight: "700" }}>Cerrar</Text>
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
    contenedor: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 14,
      paddingVertical: 6,
      backgroundColor: colores.navy,
    },
    version: { color: "rgba(255,255,255,0.7)", fontSize: 11, flexShrink: 1 },
    // 36x36: piso táctil cómodo para un dedo en una barra estrecha.
    botonTema: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center" },
    botonTemaTexto: { fontSize: 15 },
    boton: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 6,
      backgroundColor: "rgba(255,255,255,0.12)",
      minWidth: 90,
      alignItems: "center",
    },
    botonTexto: { color: "#fff", fontSize: 11, fontWeight: "600" },
    fondoModal: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", padding: 24 },
    ventana: { width: "100%", maxWidth: 440, borderRadius: 14, padding: 20, gap: 10 },
    tituloVentana: { fontSize: 20, fontWeight: "800" },
    textoVentana: { fontSize: 13, lineHeight: 18 },
    pista: { height: 14, borderRadius: 7, overflow: "hidden", marginTop: 6 },
    relleno: { height: 14, borderRadius: 7 },
    filaBotonesVentana: { flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center", marginTop: 8 },
    botonVentana: { borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16 },
    botonVentanaTexto: { color: "#fff", fontWeight: "800" },
    botonVentanaSecundario: { paddingVertical: 12, paddingHorizontal: 8 },
  });
}
