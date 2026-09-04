import { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { baseUrl, useConexionStore, validarHost, validarPuerto } from "../store/conexionStore";
import { useAuthStore } from "../store/authStore";
import { usarColores } from "../store/temaStore";
import { actualizarMenu } from "../sync/actualizarMenu";

type ResultadoPrueba = { ok: true; nombre: string | null } | { ok: false; mensaje: string } | null;

function formatearFecha(ms: number): string {
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()} ${hh}:${mi}`;
}

/** Módulo "Conexión": configurar y probar la conexión entre la app y el sistema/software
 *  instalado en la PC del local (la "Estación"), y desde ahí forzar una sincronización real del
 *  menú/catálogo (APK -> API de la Estación -> base de datos -> APK, nunca un archivo a mano).
 *  Se muestra al iniciar si aún no hay Estación configurada, desde "⚙ Estación" en el login, y
 *  como pestaña propia dentro de la app ya logeada (ver App.tsx) — en ese último caso además se
 *  habilita "Actualizar menú", que necesita una sesión activa (es por sucursal). */
export function ConexionScreen({ onConectado, onCancelar }: { onConectado?: () => void; onCancelar?: () => void }) {
  const conexion = useConexionStore();
  const { host, puerto, estado, nombreEstacion, ultimaActualizacionMenu, productosSincronizados, sincronizandoMenu, probarYGuardar } = conexion;
  const usuario = useAuthStore((s) => s.usuario);
  const colores = usarColores();
  const estilos = crearEstilos(colores);

  const [ip, setIp] = useState(host);
  const [pto, setPto] = useState(puerto);
  const [probando, setProbando] = useState(false);
  const [resultadoPrueba, setResultadoPrueba] = useState<ResultadoPrueba>(null);
  const [guardando, setGuardando] = useState(false);
  const [mensajeGuardado, setMensajeGuardado] = useState<string | null>(null);
  const [mensajeMenu, setMensajeMenu] = useState<{ ok: boolean; texto: string } | null>(null);

  /** Prueba la IP/puerto TAL COMO están escritos, sin guardarlos todavía — separado de
   *  "Guardar" a propósito (el spec lo pide así): se puede probar varias veces antes de decidir
   *  quedarse con una configuración. */
  async function probarConexion() {
    setMensajeGuardado(null);
    const errorIp = validarHost(ip.trim());
    const errorPuerto = validarPuerto(pto.trim());
    if (errorIp || errorPuerto) {
      setResultadoPrueba({ ok: false, mensaje: errorIp ?? errorPuerto! });
      return;
    }
    setProbando(true);
    try {
      const controlador = new AbortController();
      const limite = setTimeout(() => controlador.abort(), 5000);
      const res = await fetch(`${baseUrl(ip.trim(), pto.trim())}/api/v1/health`, { signal: controlador.signal });
      clearTimeout(limite);
      if (!res.ok) throw new Error(`La Estación respondió con error ${res.status}`);
      const body = await res.json().catch(() => ({}));
      setResultadoPrueba({ ok: true, nombre: body?.empresa ?? null });
    } catch (e: any) {
      const mensaje =
        e?.name === "AbortError"
          ? "Tiempo de espera agotado. Puede ser que: el equipo esté apagado, la IP sea incorrecta, no estén en la misma red Wi-Fi, o un firewall esté bloqueando el puerto."
          : e?.message?.startsWith("La Estación respondió con error")
            ? `${e.message} — el puerto puede pertenecer a otro programa, no al software HANGAR 421.`
            : "No se pudo conectar. Revisa que: la IP y el puerto sean correctos, el software de PC esté corriendo (servicio no disponible), y el equipo esté en la misma red.";
      setResultadoPrueba({ ok: false, mensaje });
    } finally {
      setProbando(false);
    }
  }

  async function guardar() {
    setMensajeGuardado(null);
    setGuardando(true);
    const ok = await probarYGuardar(ip.trim(), pto.trim());
    setGuardando(false);
    if (ok) {
      setMensajeGuardado("✓ Configuración guardada correctamente");
      onConectado?.();
    }
  }

  async function actualizarMenuUI() {
    setMensajeMenu(null);
    const r = await actualizarMenu();
    setMensajeMenu(
      r.ok ? { ok: true, texto: `✓ Menú actualizado correctamente — ${r.productos} productos` } : { ok: false, texto: `✕ ${r.error}` },
    );
  }

  const estadoColor = estado === "conectado" ? colores.green : estado === "verificando" ? colores.amber : colores.red;
  const estadoTexto = estado === "conectado" ? "🟢 Conectado" : estado === "verificando" ? "🟡 Verificando…" : "🔴 Desconectado";

  return (
    <View style={estilos.contenedor}>
      <View style={estilos.tarjeta}>
        <Text style={estilos.titulo}>CONEXIÓN</Text>
        <Text style={estilos.subtitulo}>Estación (PC del local)</Text>

        {/* Estado actual — lo que YA está guardado y activo, no lo que se esté escribiendo abajo */}
        <View style={estilos.estadoBloque}>
          <FilaEstado etiqueta="Servidor" valor={nombreEstacion ?? "No conectado"} colores={colores} />
          <FilaEstado etiqueta="IP" valor={host || "—"} colores={colores} />
          <FilaEstado etiqueta="Puerto" valor={puerto || "—"} colores={colores} />
          <FilaEstado etiqueta="Estado" valor={estadoTexto} colores={colores} valorColor={estadoColor} />
        </View>

        <Text style={estilos.seccion}>Datos de conexión</Text>
        <TextInput
          placeholder="IP del servidor (p.ej. 192.168.1.100)"
          placeholderTextColor={colores.textoSecundario}
          value={ip}
          onChangeText={(t) => { setIp(t); setResultadoPrueba(null); }}
          autoCapitalize="none"
          keyboardType="numbers-and-punctuation"
          style={estilos.input}
        />
        <TextInput
          placeholder="Puerto (p.ej. 3000)"
          placeholderTextColor={colores.textoSecundario}
          value={pto}
          onChangeText={(t) => { setPto(t); setResultadoPrueba(null); }}
          keyboardType="number-pad"
          style={estilos.input}
        />

        {resultadoPrueba?.ok === true && (
          <Text style={estilos.ok}>✓ Conexión exitosa{resultadoPrueba.nombre ? ` — ${resultadoPrueba.nombre}` : ""}</Text>
        )}
        {resultadoPrueba?.ok === false && <Text style={estilos.error}>✕ No se pudo establecer la conexión{"\n"}{resultadoPrueba.mensaje}</Text>}
        {mensajeGuardado && <Text style={estilos.ok}>{mensajeGuardado}</Text>}

        <TouchableOpacity style={estilos.botonSecundario} onPress={probarConexion} disabled={probando || !ip.trim() || !pto.trim()}>
          {probando ? <ActivityIndicator color={colores.navyTexto} /> : <Text style={estilos.botonSecundarioTexto}>Probar conexión</Text>}
        </TouchableOpacity>

        {usuario && (
          <>
            <Text style={estilos.seccion}>Menú / catálogo</Text>
            <TouchableOpacity style={estilos.botonSecundario} onPress={actualizarMenuUI} disabled={sincronizandoMenu}>
              {sincronizandoMenu ? <ActivityIndicator color={colores.navyTexto} /> : <Text style={estilos.botonSecundarioTexto}>Actualizar menú</Text>}
            </TouchableOpacity>
            {mensajeMenu && <Text style={mensajeMenu.ok ? estilos.ok : estilos.error}>{mensajeMenu.texto}</Text>}
            <View style={estilos.metaMenu}>
              <Text style={estilos.metaMenuTexto}>
                Última actualización: {ultimaActualizacionMenu ? formatearFecha(ultimaActualizacionMenu) : "Nunca"}
              </Text>
              <Text style={estilos.metaMenuTexto}>
                Productos sincronizados: {productosSincronizados ?? "—"}
              </Text>
            </View>
          </>
        )}

        <TouchableOpacity
          style={[estilos.boton, (guardando || !ip.trim() || !pto.trim()) && estilos.botonDeshabilitado]}
          onPress={guardar}
          disabled={guardando || !ip.trim() || !pto.trim()}
        >
          {guardando ? <ActivityIndicator color="#fff" /> : <Text style={estilos.botonTexto}>Guardar</Text>}
        </TouchableOpacity>

        {onCancelar && (
          <TouchableOpacity style={estilos.cancelar} onPress={onCancelar}>
            <Text style={estilos.cancelarTexto}>Cancelar</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function FilaEstado({
  etiqueta,
  valor,
  colores,
  valorColor,
}: {
  etiqueta: string;
  valor: string;
  colores: ReturnType<typeof usarColores>;
  valorColor?: string;
}) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 }}>
      <Text style={{ color: colores.textoSecundario, fontSize: 13 }}>{etiqueta}</Text>
      <Text style={{ color: valorColor ?? colores.texto, fontSize: 13, fontWeight: "700" }}>{valor}</Text>
    </View>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    contenedor: { flex: 1, backgroundColor: colores.navy, alignItems: "center", justifyContent: "center", padding: 20 },
    tarjeta: { backgroundColor: colores.superficie, borderRadius: 20, padding: 24, width: "100%", maxWidth: 420 },
    titulo: { fontSize: 24, fontWeight: "800", color: colores.navyTexto, textAlign: "center", letterSpacing: 1 },
    subtitulo: { textAlign: "center", color: colores.textoSecundario, marginBottom: 14, fontWeight: "600" },
    estadoBloque: { backgroundColor: colores.fondo, borderRadius: 12, padding: 12, marginBottom: 16 },
    seccion: { fontSize: 12, fontWeight: "800", color: colores.textoSecundario, textTransform: "uppercase", marginTop: 14, marginBottom: 4, letterSpacing: 0.5 },
    input: { borderWidth: 1, borderColor: colores.borde, borderRadius: 10, padding: 14, marginTop: 8, fontSize: 16, color: colores.texto },
    ok: { color: colores.green, marginTop: 10, fontWeight: "600", fontSize: 13, lineHeight: 18 },
    error: { color: colores.red, marginTop: 10, fontSize: 13, lineHeight: 18 },
    botonSecundario: {
      backgroundColor: colores.fondo, borderWidth: 1, borderColor: colores.borde, borderRadius: 12,
      padding: 14, marginTop: 10, minHeight: 50, alignItems: "center", justifyContent: "center",
    },
    botonSecundarioTexto: { color: colores.navyTexto, fontWeight: "700", fontSize: 15 },
    metaMenu: { marginTop: 8 },
    metaMenuTexto: { color: colores.textoSecundario, fontSize: 12, marginTop: 2 },
    boton: { backgroundColor: colores.navy, borderRadius: 12, padding: 16, marginTop: 18, minHeight: 56, alignItems: "center", justifyContent: "center" },
    botonDeshabilitado: { opacity: 0.5 },
    botonTexto: { color: "#fff", fontWeight: "700", fontSize: 16 },
    cancelar: { marginTop: 12, alignItems: "center", padding: 6 },
    cancelarTexto: { color: colores.textoSecundario, fontSize: 13 },
  });
}
